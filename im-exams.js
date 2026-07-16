/* ==========================================================================
   im-exams.js — Exam assembly engine + instructor exam builder + student runner
   for the Introduction to Microeconomics platform.

   SAFARI-SAFE: no optional chaining, no nullish coalescing, no template
   literals, no arrow functions. Uses var + function declarations + string concat.

   Depends on: IMGenerators (generate/grade/list), IMDiagrams (via IMQuiz), IMQuiz.
   Exposes: window.IMExams with:
     - CHAPTER_TITLES, MIDTERM_CHAPTERS, FINAL_CHAPTERS
     - assemble(recipe)         -> { items:[{generatorId, seed, chapter, kind, render, points}], totalPoints, warnings }
     - templateMidterm(seedBase), templateFinal(seedBase)
     - renderBuilder(mountEl, cfg)   -> instructor UI to design an exam / recipe
     - renderExam(examSpec, mountEl, cfg) -> student-facing exam runner (uses IMQuiz.quiz)
   ========================================================================== */
(function () {
  "use strict";

  /* ---- chapter metadata ------------------------------------------------- */
  var CHAPTER_TITLES = {
    1: "Ten Principles of Economics",
    2: "Thinking Like an Economist",
    3: "Interdependence & Gains from Trade",
    4: "Supply and Demand",
    5: "Elasticity and Its Application",
    6: "Government Policies (Controls & Taxes)",
    7: "Consumers, Producers & Efficiency of Markets",
    8: "Application: Costs of Taxation",
    9: "The Costs of Production",
    10: "Firms in Competitive Markets",
    11: "Monopoly",
    12: "Monopolistic Competition",
    13: "Oligopoly",
    14: "Markets for the Factors of Production",
    15: "Externalities",
    16: "Markets with Asymmetric Information",
    17: "Behavioral Economics"
  };

  /* Standard split: midterm covers the first half, final the second half.
     (Instructors can override chapter sets freely in a custom recipe.) */
  var MIDTERM_CHAPTERS = [1, 2, 3, 4, 5, 6, 7, 8];
  var FINAL_CHAPTERS = [9, 10, 11, 12, 13, 14, 15, 16, 17];

  /* ---- small deterministic PRNG for reproducible exam assembly ---------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffleInPlace(rng, arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---- bank access ------------------------------------------------------ */
  /* Returns the pool of items for a chapter, filtered.
     opts: { examOnly:bool (require in_exams flag if present), kinds:[...],
             minDifficulty, excludeIds:{} } */
  function chapterPool(chapter, opts) {
    opts = opts || {};
    var all = window.IMGenerators.list();
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var it = all[i];
      if (it.chapter !== chapter) { continue; }
      if (opts.kinds && opts.kinds.length && indexOf(opts.kinds, it.kind) < 0) { continue; }
      if (opts.excludeIds && opts.excludeIds[it.id]) { continue; }
      out.push(it);
    }
    return out;
  }
  function indexOf(arr, v) { for (var i = 0; i < arr.length; i++) { if (arr[i] === v) { return i; } } return -1; }

  function itemPoints(id, seed) {
    var q = window.IMGenerators.generate(id, seed || 1);
    return (q && q.points) ? q.points : 1;
  }

  /* ======================================================================
     ASSEMBLE — the core engine.
     recipe = {
       seedBase: <int>,               // makes assembly + question seeds reproducible
       chapters: [ints]  OR  perChapter: { <ch>: <count> },
       count: <int>,                  // total questions (used with chapters[] for even split)
       difficultyMix: { easy:%, med:%, hard:% } (optional; best-effort),
       kinds: [ 'mc','numeric','short' ] (optional filter; default all),
       includeGraphical: bool (default true),
       hardExtra: <int>,              // add N extra multi-step 'hard' questions on top
       avoidIds: { id:true }          // e.g., questions used in this student's practice
     }
     Even representation: distributes count as evenly as possible across the
     chapters, then within each chapter respects the difficulty mix as best it
     can. Every drawn item gets a FRESH seed derived from seedBase, so the
     numbers/graph differ from any the student saw in practice.
     Returns { items, totalPoints, warnings, byChapter }.
     ====================================================================== */
  function assemble(recipe) {
    recipe = recipe || {};
    var seedBase = (recipe.seedBase != null) ? (recipe.seedBase >>> 0) : (Math.floor(Math.random() * 2000000000) >>> 0);
    var rng = mulberry32(seedBase);
    var warnings = [];

    /* 1. Resolve how many questions per chapter. */
    var perChapter = {};
    var chapters;
    if (recipe.perChapter) {
      chapters = [];
      for (var k in recipe.perChapter) {
        if (recipe.perChapter.hasOwnProperty(k) && recipe.perChapter[k] > 0) {
          var chNum = parseInt(k, 10);
          perChapter[chNum] = recipe.perChapter[k];
          chapters.push(chNum);
        }
      }
      chapters.sort(function (a, b) { return a - b; });
    } else {
      chapters = (recipe.chapters && recipe.chapters.length) ? recipe.chapters.slice() : [];
      chapters.sort(function (a, b) { return a - b; });
      var total = recipe.count || 0;
      if (!chapters.length || !total) {
        return { items: [], totalPoints: 0, warnings: ["No chapters or count specified."], byChapter: {} };
      }
      /* even split with remainder distributed to the first chapters */
      var base = Math.floor(total / chapters.length);
      var rem = total - base * chapters.length;
      for (var c = 0; c < chapters.length; c++) {
        perChapter[chapters[c]] = base + (c < rem ? 1 : 0);
      }
    }

    /* 2. Difficulty targets (optional). */
    var mix = recipe.difficultyMix || null;

    /* 3. Kinds filter & graphical inclusion. */
    var kinds = recipe.kinds && recipe.kinds.length ? recipe.kinds : null;
    var includeGraphical = (recipe.includeGraphical !== false);
    var avoid = recipe.avoidIds || {};

    /* 4. Draw per chapter. */
    var chosen = [];       /* list of {id, chapter, kind, render, difficulty} */
    var usedIds = {};
    var byChapter = {};

    for (var ci = 0; ci < chapters.length; ci++) {
      var ch = chapters[ci];
      var want = perChapter[ch];
      byChapter[ch] = 0;
      var pool = chapterPool(ch, { kinds: kinds, excludeIds: avoid });
      if (!includeGraphical) {
        pool = filterOut(pool, function (it) { return it.render === "graphical"; });
      }
      /* remove already-used (across the exam) */
      pool = filterOut(pool, function (it) { return usedIds[it.id]; });

      if (pool.length < want) {
        warnings.push("Chapter " + ch + ": requested " + want + " but only " + pool.length +
          " eligible questions exist" + (Object.keys(avoid).length ? " after excluding practice questions" : "") + ". Using all available.");
      }

      var picks = pickWithMix(rng, pool, want, mix);
      for (var p = 0; p < picks.length; p++) {
        usedIds[picks[p].id] = true;
        chosen.push(picks[p]);
        byChapter[ch]++;
      }
    }

    /* 5. Extra hard multi-step questions (drawn from any requested chapter, hard only). */
    var hardExtra = recipe.hardExtra || 0;
    if (hardExtra > 0) {
      var hardPool = [];
      for (var hc = 0; hc < chapters.length; hc++) {
        var hp = chapterPool(chapters[hc], { kinds: kinds, excludeIds: avoid });
        for (var hh = 0; hh < hp.length; hh++) {
          if (hp[hh].difficulty === "hard" && !usedIds[hp[hh].id]) {
            if (includeGraphical || hp[hh].render !== "graphical") { hardPool.push(hp[hh]); }
          }
        }
      }
      shuffleInPlace(rng, hardPool);
      var added = 0;
      for (var hpi = 0; hpi < hardPool.length && added < hardExtra; hpi++) {
        usedIds[hardPool[hpi].id] = true;
        chosen.push(hardPool[hpi]);
        byChapter[hardPool[hpi].chapter] = (byChapter[hardPool[hpi].chapter] || 0) + 1;
        added++;
      }
      if (added < hardExtra) {
        warnings.push("Requested " + hardExtra + " extra hard questions but only " + added + " were available.");
      }
    }

    /* 6. Order: by default interleave chapters so the exam flows in course order;
          the exam runner can still shuffle if shuffle_questions is set. */
    chosen.sort(function (a, b) { return a.chapter - b.chapter; });

    /* 7. Assign fresh, reproducible seeds and compute points. */
    var items = [];
    var totalPoints = 0;
    for (var q = 0; q < chosen.length; q++) {
      /* Seed derived from seedBase + position + a hash of the id so exam
         instances differ from practice and from each other, yet are reproducible. */
      var seed = ((seedBase + (q + 1) * 2654435761 + hashStr(chosen[q].id)) >>> 0) || 1;
      var pts = itemPoints(chosen[q].id, seed);
      totalPoints += pts;
      items.push({
        generatorId: chosen[q].id,
        seed: seed,
        chapter: chosen[q].chapter,
        kind: chosen[q].kind,
        render: chosen[q].render,
        difficulty: chosen[q].difficulty,
        points: pts
      });
    }

    return { items: items, totalPoints: totalPoints, warnings: warnings, byChapter: byChapter, seedBase: seedBase };
  }

  function filterOut(arr, pred) {
    var out = [];
    for (var i = 0; i < arr.length; i++) { if (!pred(arr[i])) { out.push(arr[i]); } }
    return out;
  }
  function hashStr(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; }
    return h;
  }

  /* Pick want items from pool, honoring difficulty mix as best-effort.
     If mix is null, pick uniformly at random. */
  function pickWithMix(rng, pool, want, mix) {
    if (want <= 0) { return []; }
    var shuffled = pool.slice();
    shuffleInPlace(rng, shuffled);
    if (want >= shuffled.length) { return shuffled.slice(0, want); }
    if (!mix) { return shuffled.slice(0, want); }

    /* bucket by difficulty */
    var buckets = { easy: [], med: [], hard: [] };
    for (var i = 0; i < shuffled.length; i++) {
      var dd = shuffled[i].difficulty || "med";
      if (!buckets[dd]) { buckets[dd] = []; }
      buckets[dd].push(shuffled[i]);
    }
    /* target counts */
    var targets = {
      easy: Math.round((mix.easy || 0) / 100 * want),
      med: Math.round((mix.med || 0) / 100 * want),
      hard: Math.round((mix.hard || 0) / 100 * want)
    };
    /* fix rounding so sum == want */
    var sum = targets.easy + targets.med + targets.hard;
    while (sum < want) { targets.med++; sum++; }
    while (sum > want) { if (targets.med > 0) { targets.med--; } else if (targets.hard > 0) { targets.hard--; } else { targets.easy--; } sum--; }

    var out = [];
    ["easy", "med", "hard"].forEach(function (level) {
      var t = targets[level];
      var b = buckets[level] || [];
      for (var j = 0; j < t && j < b.length; j++) { out.push(b[j]); }
    });
    /* backfill from any remaining if short (a chapter may lack, e.g., easy items) */
    if (out.length < want) {
      var usedLocal = {};
      for (var u = 0; u < out.length; u++) { usedLocal[out[u].id] = true; }
      for (var f = 0; f < shuffled.length && out.length < want; f++) {
        if (!usedLocal[shuffled[f].id]) { out.push(shuffled[f]); usedLocal[shuffled[f].id] = true; }
      }
    }
    return out.slice(0, want);
  }

  /* ---- templates -------------------------------------------------------- */
  /* Midterm: exactly 40 questions, first half (Ch 1-8), evenly represented,
     with a hard tilt. 4 of the 40 are extra multi-step hard questions. */
  function templateMidterm(seedBase) {
    return assemble({
      seedBase: seedBase,
      chapters: MIDTERM_CHAPTERS,
      count: 36,
      difficultyMix: { easy: 15, med: 35, hard: 50 },
      includeGraphical: true,
      hardExtra: 4
    });
  }
  /* Final: exactly 50 questions, second half (Ch 9-17), evenly represented.
     5 of the 50 are extra multi-step hard questions. */
  function templateFinal(seedBase) {
    return assemble({
      seedBase: seedBase,
      chapters: FINAL_CHAPTERS,
      count: 45,
      difficultyMix: { easy: 12, med: 33, hard: 55 },
      includeGraphical: true,
      hardExtra: 5
    });
  }

  /* ======================================================================
     STUDENT EXAM RUNNER — wraps IMQuiz.quiz with an assembled item list.
     examSpec = { title, items:[{generatorId, seed, points}], timeLimitMinutes,
                  shuffle:bool, proctored:bool }
     cfg = { onSubmit(results), gradeEndpoint, ... } forwarded to IMQuiz.
     ====================================================================== */
  function renderExam(examSpec, mountEl, cfg) {
    cfg = cfg || {};
    var spec = {
      title: examSpec.title || "Exam",
      items: examSpec.items.map(function (it) {
        return { generatorId: it.generatorId, seed: it.seed };
      }),
      timeLimitMinutes: examSpec.timeLimitMinutes || null,
      shuffle: examSpec.shuffle !== false,
      proctored: !!examSpec.proctored
    };
    if (window.IMQuiz && window.IMQuiz.quiz) {
      return window.IMQuiz.quiz(spec, mountEl, cfg);
    }
    mountEl.innerHTML = "<p style='color:#991b1b'>Exam engine (IMQuiz) not loaded.</p>";
    return null;
  }

  /* ======================================================================
     INSTRUCTOR EXAM BUILDER UI
     renderBuilder(mountEl, cfg)
     cfg = {
       onSave(examSpec, recipe)   // called with the assembled exam + recipe to persist
       initialRecipe             // optional prefill
       allowChapters: [ints]     // which chapters the course covers (default 1-17)
     }
     The builder lets an instructor:
       - pick a preset (Midterm / Final / Custom)
       - choose which chapters to include (checkboxes)
       - set total number of questions OR per-chapter counts
       - set difficulty mix (sliders)
       - filter question kinds (MC / numeric / written) & toggle graphical
       - add extra hard multi-step questions
       - set title, time limit, attempts, shuffle, proctoring
       - preview the assembled exam (counts by chapter, total points, warnings)
       - regenerate (new seed) or lock a seed for reproducibility
     ====================================================================== */
  function renderBuilder(mountEl, cfg) {
    cfg = cfg || {};
    var allowChapters = cfg.allowChapters || rangeArr(1, 17);
    var state = {
      preset: "custom",
      mode: "total",                 /* 'total' | 'perChapter' */
      chapters: {},                  /* ch -> bool */
      perChapter: {},                /* ch -> int */
      count: 40,
      mix: { easy: 15, med: 35, hard: 50 },
      kinds: { mc: true, numeric: true, short: true },
      includeGraphical: true,
      hardExtra: 0,
      title: "Custom Exam",
      timeLimitMinutes: 60,
      maxAttempts: 1,
      attemptScoring: "best",
      shuffle: true,
      proctored: false,
      seedBase: null,                /* null = random each build; number = locked */
      lastResult: null
    };
    /* default: select all allowed chapters */
    for (var a = 0; a < allowChapters.length; a++) { state.chapters[allowChapters[a]] = true; state.perChapter[allowChapters[a]] = 3; }
    if (cfg.initialRecipe) { applyRecipe(state, cfg.initialRecipe); }

    var root = document.createElement("div");
    root.className = "im-exam-builder";
    mountEl.innerHTML = "";
    mountEl.appendChild(root);
    injectStyles();

    function draw() {
      root.innerHTML =
        headerHtml() +
        presetHtml() +
        metaHtml() +
        chaptersHtml() +
        countHtml() +
        mixHtml() +
        kindsHtml() +
        optionsHtml() +
        previewHtml() +
        actionsHtml();
      wire();
    }

    /* ---- section renderers (return HTML strings) ---- */
    function headerHtml() {
      return "<div class='xb-head'><h2>Exam Builder</h2>" +
        "<p class='xb-sub'>Assemble a midterm, final, or a fully custom exam from the question bank. " +
        "Every question is drawn with a fresh randomized instance, so students see different numbers and graphs than they did in practice.</p></div>";
    }
    function presetHtml() {
      return "<div class='xb-card'><div class='xb-row'>" +
        presetBtn("midterm", "Midterm (40, Ch 1&ndash;8)") +
        presetBtn("final", "Final (50, Ch 9&ndash;17)") +
        presetBtn("custom", "Custom") +
        "</div></div>";
    }
    function presetBtn(id, label) {
      var on = state.preset === id;
      return "<button class='xb-preset" + (on ? " on" : "") + "' data-preset='" + id + "'>" + label + "</button>";
    }
    function metaHtml() {
      return "<div class='xb-card'>" +
        field("Title", "<input id='xb-title' type='text' value='" + esc(state.title) + "'>") +
        "<div class='xb-grid3'>" +
        field("Time limit (min)", "<input id='xb-time' type='number' min='0' value='" + (state.timeLimitMinutes || 0) + "'>") +
        field("Max attempts", "<input id='xb-attempts' type='number' min='1' value='" + state.maxAttempts + "'>") +
        field("Scoring", "<select id='xb-scoring'>" +
          opt("best", "Best", state.attemptScoring) + opt("last", "Last", state.attemptScoring) + opt("avg", "Average", state.attemptScoring) +
          "</select>") +
        "</div></div>";
    }
    function chaptersHtml() {
      var rows = "";
      for (var i = 0; i < allowChapters.length; i++) {
        var ch = allowChapters[i];
        var on = !!state.chapters[ch];
        var pool = chapterPoolCount(ch);
        rows += "<label class='xb-chip" + (on ? " on" : "") + "'>" +
          "<input type='checkbox' data-ch='" + ch + "'" + (on ? " checked" : "") + ">" +
          "<span class='xb-chnum'>Ch " + ch + "</span>" +
          "<span class='xb-chname'>" + esc(CHAPTER_TITLES[ch] || ("Chapter " + ch)) + "</span>" +
          "<span class='xb-chpool'>" + pool + " Q</span>" +
          (state.mode === "perChapter" && on ?
            "<input class='xb-perch' type='number' min='0' data-perch='" + ch + "' value='" + (state.perChapter[ch] || 0) + "'>" : "") +
          "</label>";
      }
      return "<div class='xb-card'><div class='xb-cardhead'><h3>Chapters</h3>" +
        "<div class='xb-seg'>" +
        "<button class='xb-segbtn" + (state.mode === "total" ? " on" : "") + "' data-mode='total'>Even split</button>" +
        "<button class='xb-segbtn" + (state.mode === "perChapter" ? " on" : "") + "' data-mode='perChapter'>Per-chapter counts</button>" +
        "</div></div>" +
        "<div class='xb-selrow'><button class='xb-mini' id='xb-selall'>Select all</button>" +
        "<button class='xb-mini' id='xb-selnone'>Clear</button>" +
        "<button class='xb-mini' id='xb-selfirst'>First half (1&ndash;8)</button>" +
        "<button class='xb-mini' id='xb-selsecond'>Second half (9&ndash;17)</button></div>" +
        "<div class='xb-chips'>" + rows + "</div></div>";
    }
    function countHtml() {
      if (state.mode === "perChapter") {
        var tot = 0;
        for (var ch in state.perChapter) { if (state.chapters[ch]) { tot += (state.perChapter[ch] || 0); } }
        return "<div class='xb-card'><div class='xb-total'>Total questions: <b>" + tot + "</b> " +
          "<span class='xb-hint'>(set each chapter's count above)</span></div></div>";
      }
      return "<div class='xb-card'>" +
        field("Total number of questions", "<input id='xb-count' type='number' min='1' value='" + state.count + "'>") +
        "<p class='xb-hint'>Distributed as evenly as possible across the selected chapters so every topic is represented.</p></div>";
    }
    function mixHtml() {
      return "<div class='xb-card'><h3>Difficulty mix</h3>" +
        slider("easy", "Easy", state.mix.easy) +
        slider("med", "Medium", state.mix.med) +
        slider("hard", "Hard", state.mix.hard) +
        "<p class='xb-hint'>Best-effort target &mdash; if a chapter lacks a difficulty level, the builder backfills from others. Percentages need not sum to 100 (they are normalized).</p></div>";
    }
    function kindsHtml() {
      return "<div class='xb-card'><h3>Question types</h3><div class='xb-row'>" +
        toggle("mc", "Multiple choice", state.kinds.mc) +
        toggle("numeric", "Numerical", state.kinds.numeric) +
        toggle("short", "Written (AI-graded)", state.kinds.short) +
        "</div><div class='xb-row' style='margin-top:.5rem'>" +
        "<label class='xb-check'><input type='checkbox' id='xb-graph'" + (state.includeGraphical ? " checked" : "") + "> Include graphical (diagram) questions</label>" +
        "</div></div>";
    }
    function optionsHtml() {
      return "<div class='xb-card'><div class='xb-grid3'>" +
        field("Extra hard multi-step questions", "<input id='xb-hardextra' type='number' min='0' value='" + state.hardExtra + "'>") +
        field("Shuffle question order", "<select id='xb-shuffle'>" + opt("yes", "Yes", state.shuffle ? "yes" : "no") + opt("no", "No", state.shuffle ? "yes" : "no") + "</select>") +
        field("Proctoring", "<select id='xb-proctor'>" + opt("no", "Off", state.proctored ? "yes" : "no") + opt("yes", "On", state.proctored ? "yes" : "no") + "</select>") +
        "</div>" +
        "<div class='xb-grid2'>" +
        field("Reproducible seed (optional)", "<input id='xb-seed' type='number' placeholder='blank = new each build' value='" + (state.seedBase != null ? state.seedBase : "") + "'>") +
        "<div class='xb-seedhelp'>Lock a seed to reproduce the exact same exam draw later (useful for makeup exams that must match).</div>" +
        "</div></div>";
    }
    function previewHtml() {
      var r = state.lastResult;
      if (!r) { return "<div class='xb-card xb-preview'><h3>Preview</h3><p class='xb-hint'>Click <b>Build preview</b> to assemble and inspect the exam.</p></div>"; }
      var chRows = "";
      var chs = Object.keys(r.byChapter).sort(function (a, b) { return a - b; });
      for (var i = 0; i < chs.length; i++) {
        var ch = chs[i];
        chRows += "<tr><td>Ch " + ch + " &mdash; " + esc(CHAPTER_TITLES[ch] || "") + "</td><td class='xb-num'>" + r.byChapter[ch] + "</td></tr>";
      }
      var warn = "";
      if (r.warnings && r.warnings.length) {
        warn = "<div class='xb-warn'><b>Notes:</b><ul>";
        for (var w = 0; w < r.warnings.length; w++) { warn += "<li>" + esc(r.warnings[w]) + "</li>"; }
        warn += "</ul></div>";
      }
      /* difficulty + kind breakdown */
      var dc = { easy: 0, med: 0, hard: 0 }, kc = { mc: 0, numeric: 0, short: 0 }, gr = 0;
      for (var it = 0; it < r.items.length; it++) {
        var x = r.items[it];
        dc[x.difficulty] = (dc[x.difficulty] || 0) + 1;
        kc[x.kind] = (kc[x.kind] || 0) + 1;
        if (x.render === "graphical") { gr++; }
      }
      return "<div class='xb-card xb-preview'><h3>Preview</h3>" +
        "<div class='xb-summary'>" +
        "<div class='xb-stat'><span class='xb-statnum'>" + r.items.length + "</span><span>questions</span></div>" +
        "<div class='xb-stat'><span class='xb-statnum'>" + r.totalPoints + "</span><span>points</span></div>" +
        "<div class='xb-stat'><span class='xb-statnum'>" + gr + "</span><span>graphical</span></div>" +
        "<div class='xb-stat'><span class='xb-statnum'>" + r.seedBase + "</span><span>seed</span></div>" +
        "</div>" +
        "<div class='xb-breakdown'>Difficulty: " + dc.easy + " easy &middot; " + dc.med + " medium &middot; " + dc.hard + " hard" +
        " &nbsp;|&nbsp; Types: " + kc.mc + " MC &middot; " + kc.numeric + " numeric &middot; " + kc.short + " written</div>" +
        "<table class='xb-table'><thead><tr><th>Chapter</th><th class='xb-num'>Questions</th></tr></thead><tbody>" + chRows + "</tbody></table>" +
        warn + "</div>";
    }
    function actionsHtml() {
      return "<div class='xb-actions'>" +
        "<button class='xb-btn xb-secondary' id='xb-build'>Build preview</button>" +
        "<button class='xb-btn xb-secondary' id='xb-regen'>Regenerate (new seed)</button>" +
        "<button class='xb-btn xb-primary' id='xb-save'" + (state.lastResult ? "" : " disabled") + ">Save exam</button>" +
        "</div>";
    }

    /* ---- helpers for html ---- */
    function field(label, control) { return "<div class='xb-field'><label>" + label + "</label>" + control + "</div>"; }
    function opt(v, label, cur) { return "<option value='" + v + "'" + (cur === v ? " selected" : "") + ">" + label + "</option>"; }
    function slider(id, label, val) {
      return "<div class='xb-slider'><label>" + label + " <b id='xb-mixval-" + id + "'>" + val + "%</b></label>" +
        "<input type='range' min='0' max='100' value='" + val + "' data-mix='" + id + "'></div>";
    }
    function toggle(id, label, on) {
      return "<label class='xb-check'><input type='checkbox' data-kind='" + id + "'" + (on ? " checked" : "") + "> " + label + "</label>";
    }

    /* ---- wire events ---- */
    function wire() {
      root.querySelectorAll("[data-preset]").forEach(function (b) {
        b.onclick = function () { applyPreset(b.getAttribute("data-preset")); };
      });
      root.querySelectorAll("[data-mode]").forEach(function (b) {
        b.onclick = function () { state.mode = b.getAttribute("data-mode"); draw(); };
      });
      root.querySelectorAll("[data-ch]").forEach(function (cb) {
        cb.onclick = function () { state.chapters[cb.getAttribute("data-ch")] = cb.checked; draw(); };
      });
      root.querySelectorAll("[data-perch]").forEach(function (inp) {
        inp.oninput = function () { state.perChapter[inp.getAttribute("data-perch")] = clampInt(inp.value, 0); recount(); };
      });
      root.querySelectorAll("[data-mix]").forEach(function (r) {
        r.oninput = function () {
          state.mix[r.getAttribute("data-mix")] = clampInt(r.value, 0);
          var lbl = root.querySelector("#xb-mixval-" + r.getAttribute("data-mix")); if (lbl) { lbl.textContent = r.value + "%"; }
        };
      });
      root.querySelectorAll("[data-kind]").forEach(function (cb) {
        cb.onclick = function () { state.kinds[cb.getAttribute("data-kind")] = cb.checked; };
      });
      bind("#xb-title", function (v) { state.title = v; });
      bind("#xb-time", function (v) { state.timeLimitMinutes = clampInt(v, 0); });
      bind("#xb-attempts", function (v) { state.maxAttempts = clampInt(v, 1); });
      bind("#xb-count", function (v) { state.count = clampInt(v, 1); });
      bind("#xb-hardextra", function (v) { state.hardExtra = clampInt(v, 0); });
      bind("#xb-seed", function (v) { state.seedBase = (v === "" ? null : clampInt(v, 0)); });
      selVal("#xb-scoring", function (v) { state.attemptScoring = v; });
      selVal("#xb-shuffle", function (v) { state.shuffle = (v === "yes"); });
      selVal("#xb-proctor", function (v) { state.proctored = (v === "yes"); });
      var g = root.querySelector("#xb-graph"); if (g) { g.onclick = function () { state.includeGraphical = g.checked; }; }
      byId("xb-selall", function () { setAll(true); });
      byId("xb-selnone", function () { setAll(false); });
      byId("xb-selfirst", function () { setChapters(MIDTERM_CHAPTERS); });
      byId("xb-selsecond", function () { setChapters(FINAL_CHAPTERS); });
      byId("xb-build", function () { build(); });
      byId("xb-regen", function () { state.seedBase = null; build(); });
      byId("xb-save", function () { save(); });
    }
    function bind(sel, fn) { var el = root.querySelector(sel); if (el) { el.oninput = function () { fn(el.value); }; } }
    function selVal(sel, fn) { var el = root.querySelector(sel); if (el) { el.onchange = function () { fn(el.value); }; } }
    function byId(id, fn) { var el = root.querySelector("#" + id); if (el) { el.onclick = fn; } }
    function recount() { var c = root.querySelector(".xb-total b"); if (c) { c.textContent = totalPerChapter(); } }

    /* ---- state actions ---- */
    function applyPreset(p) {
      state.preset = p;
      if (p === "midterm") {
        state.mode = "total"; state.count = 36; state.hardExtra = 4;
        state.mix = { easy: 15, med: 35, hard: 50 };
        state.title = "Midterm Exam"; state.timeLimitMinutes = 75;
        setChaptersSilent(MIDTERM_CHAPTERS);
      } else if (p === "final") {
        state.mode = "total"; state.count = 45; state.hardExtra = 5;
        state.mix = { easy: 12, med: 33, hard: 55 };
        state.title = "Final Exam"; state.timeLimitMinutes = 120;
        setChaptersSilent(FINAL_CHAPTERS);
      }
      draw();
    }
    function setAll(on) { for (var i = 0; i < allowChapters.length; i++) { state.chapters[allowChapters[i]] = on; } draw(); }
    function setChapters(list) { setChaptersSilent(list); draw(); }
    function setChaptersSilent(list) {
      for (var i = 0; i < allowChapters.length; i++) { state.chapters[allowChapters[i]] = false; }
      for (var j = 0; j < list.length; j++) { if (indexOf(allowChapters, list[j]) >= 0) { state.chapters[list[j]] = true; } }
    }
    function selectedChapters() {
      var out = [];
      for (var i = 0; i < allowChapters.length; i++) { if (state.chapters[allowChapters[i]]) { out.push(allowChapters[i]); } }
      return out;
    }
    function totalPerChapter() { var t = 0, chs = selectedChapters(); for (var i = 0; i < chs.length; i++) { t += (state.perChapter[chs[i]] || 0); } return t; }
    function currentKinds() {
      var out = [];
      if (state.kinds.mc) { out.push("mc"); }
      if (state.kinds.numeric) { out.push("numeric"); }
      if (state.kinds.short) { out.push("short"); }
      return out;
    }
    function currentRecipe() {
      var chs = selectedChapters();
      var recipe = {
        seedBase: state.seedBase,
        kinds: currentKinds(),
        includeGraphical: state.includeGraphical,
        difficultyMix: normalizeMix(state.mix),
        hardExtra: state.hardExtra
      };
      if (state.mode === "perChapter") {
        recipe.perChapter = {};
        for (var i = 0; i < chs.length; i++) { recipe.perChapter[chs[i]] = state.perChapter[chs[i]] || 0; }
      } else {
        recipe.chapters = chs;
        recipe.count = state.count;
      }
      return recipe;
    }
    function build() {
      var recipe = currentRecipe();
      var res = assemble(recipe);
      state.seedBase = res.seedBase;      /* lock the seed we just used so preview == saved */
      state.lastResult = res;
      draw();
    }
    function save() {
      if (!state.lastResult) { return; }
      var examSpec = {
        title: state.title,
        kind: state.preset === "custom" ? "exam" : state.preset,
        items: state.lastResult.items,
        totalPoints: state.lastResult.totalPoints,
        timeLimitMinutes: state.timeLimitMinutes || null,
        maxAttempts: state.maxAttempts,
        attemptScoring: state.attemptScoring,
        shuffle: state.shuffle,
        proctored: state.proctored,
        seedBase: state.lastResult.seedBase
      };
      if (cfg.onSave) { cfg.onSave(examSpec, currentRecipe()); }
    }

    draw();
    return { getState: function () { return state; }, rebuild: build };
  }

  /* ---- misc helpers ---- */
  function rangeArr(a, b) { var out = []; for (var i = a; i <= b; i++) { out.push(i); } return out; }
  function clampInt(v, lo) { var n = parseInt(v, 10); if (isNaN(n)) { n = lo; } if (n < lo) { n = lo; } return n; }
  function chapterPoolCount(ch) { return chapterPool(ch, {}).length; }
  function normalizeMix(mix) {
    var s = (mix.easy || 0) + (mix.med || 0) + (mix.hard || 0);
    if (s <= 0) { return { easy: 20, med: 40, hard: 40 }; }
    return { easy: (mix.easy || 0) / s * 100, med: (mix.med || 0) / s * 100, hard: (mix.hard || 0) / s * 100 };
  }
  function applyRecipe(state, recipe) {
    if (recipe.chapters) { for (var i = 0; i < recipe.chapters.length; i++) { /* handled by caller */ } }
    if (recipe.count) { state.count = recipe.count; }
    if (recipe.difficultyMix) { state.mix = recipe.difficultyMix; }
    if (recipe.hardExtra != null) { state.hardExtra = recipe.hardExtra; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ---- styles (scoped) ---- */
  function injectStyles() {
    if (document.getElementById("im-exam-builder-styles")) { return; }
    var css =
      ".im-exam-builder{font-family:Inter,system-ui,sans-serif;color:#0f172a;max-width:860px;margin:0 auto}" +
      ".im-exam-builder h2{font-size:1.5rem;margin:0 0 .25rem}.im-exam-builder h3{font-size:1.05rem;margin:0 0 .6rem}" +
      ".xb-sub{color:#475569;font-size:.92rem;line-height:1.5;margin:0 0 1rem}" +
      ".xb-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:1rem 1.1rem;margin-bottom:.9rem}" +
      ".xb-cardhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem}" +
      ".xb-row{display:flex;gap:.6rem;flex-wrap:wrap}" +
      ".xb-preset{flex:1;min-width:120px;padding:.7rem;border:1.5px solid #cbd5e1;background:#f8fafc;border-radius:9px;font-weight:600;cursor:pointer;font-size:.9rem}" +
      ".xb-preset.on{border-color:#0f3d9e;background:#0f3d9e;color:#fff}" +
      ".xb-field{margin-bottom:.6rem}.xb-field label{display:block;font-size:.82rem;font-weight:600;color:#334155;margin-bottom:.25rem}" +
      ".xb-field input,.xb-field select{width:100%;padding:.5rem .6rem;border:1px solid #cbd5e1;border-radius:8px;font-size:.9rem;box-sizing:border-box}" +
      ".xb-grid2{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}.xb-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:.7rem}" +
      ".xb-seg{display:inline-flex;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden}" +
      ".xb-segbtn{padding:.4rem .7rem;background:#f8fafc;border:none;cursor:pointer;font-size:.82rem;font-weight:600;color:#475569}" +
      ".xb-segbtn.on{background:#0f3d9e;color:#fff}" +
      ".xb-selrow{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.6rem}" +
      ".xb-mini{padding:.3rem .6rem;border:1px solid #cbd5e1;background:#fff;border-radius:7px;font-size:.78rem;cursor:pointer;color:#334155}" +
      ".xb-chips{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}" +
      ".xb-chip{display:flex;align-items:center;gap:.5rem;padding:.5rem .6rem;border:1.5px solid #e2e8f0;border-radius:9px;cursor:pointer;font-size:.85rem}" +
      ".xb-chip.on{border-color:#0f3d9e;background:#eff4ff}" +
      ".xb-chip input{margin:0}.xb-chnum{font-weight:700;color:#0f3d9e;white-space:nowrap}" +
      ".xb-chname{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155}" +
      ".xb-chpool{font-size:.72rem;color:#94a3b8;white-space:nowrap}" +
      ".xb-perch{width:54px!important;padding:.25rem!important;margin-left:.3rem}" +
      ".xb-total{font-size:.95rem}.xb-hint{font-size:.78rem;color:#64748b;margin:.4rem 0 0;line-height:1.4}" +
      ".xb-slider{margin-bottom:.5rem}.xb-slider label{font-size:.85rem;display:block;margin-bottom:.2rem}.xb-slider input{width:100%}" +
      ".xb-check{display:flex;align-items:center;gap:.4rem;font-size:.88rem;cursor:pointer}" +
      ".xb-seedhelp{font-size:.76rem;color:#64748b;align-self:end;line-height:1.4}" +
      ".xb-preview .xb-summary{display:flex;gap:1.2rem;margin:.4rem 0 .8rem;flex-wrap:wrap}" +
      ".xb-stat{display:flex;flex-direction:column;align-items:center}.xb-statnum{font-size:1.5rem;font-weight:800;color:#0f3d9e;line-height:1}" +
      ".xb-stat span:last-child{font-size:.72rem;color:#64748b;text-transform:uppercase;letter-spacing:.03em}" +
      ".xb-breakdown{font-size:.82rem;color:#475569;margin-bottom:.6rem}" +
      ".xb-table{width:100%;border-collapse:collapse;font-size:.85rem}.xb-table th,.xb-table td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid #f1f5f9}" +
      ".xb-table th{color:#64748b;font-size:.75rem;text-transform:uppercase}.xb-num{text-align:right!important;font-variant-numeric:tabular-nums;font-weight:600}" +
      ".xb-warn{margin-top:.7rem;background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:.6rem .8rem;font-size:.82rem;color:#854d0e}" +
      ".xb-warn ul{margin:.3rem 0 0;padding-left:1.1rem}" +
      ".xb-actions{display:flex;gap:.6rem;justify-content:flex-end;flex-wrap:wrap}" +
      ".xb-btn{padding:.65rem 1.2rem;border-radius:9px;font-weight:700;font-size:.9rem;cursor:pointer;border:none}" +
      ".xb-primary{background:#166534;color:#fff}.xb-primary:disabled{background:#cbd5e1;cursor:not-allowed}" +
      ".xb-secondary{background:#fff;border:1.5px solid #0f3d9e;color:#0f3d9e}";
    var el = document.createElement("style");
    el.id = "im-exam-builder-styles";
    el.textContent = css;
    document.head.appendChild(el);
  }

  window.IMExams = {
    CHAPTER_TITLES: CHAPTER_TITLES,
    MIDTERM_CHAPTERS: MIDTERM_CHAPTERS,
    FINAL_CHAPTERS: FINAL_CHAPTERS,
    assemble: assemble,
    templateMidterm: templateMidterm,
    templateFinal: templateFinal,
    renderBuilder: renderBuilder,
    renderExam: renderExam
  };
})();
