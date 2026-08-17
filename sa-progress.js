/* ======================================================================
   im-progress.js  —  Intro Micro shared progress reporter
   ----------------------------------------------------------------------
   ONE small module that the curriculum and every arena include. It owns:
     * the Supabase client (config in one place),
     * resolving the logged-in student + their course (same-origin session),
     * tiny helpers to record reading / quiz / arena progress.

   Because every StrategyArena file is served from the same GitHub Pages
   origin, the login session persisted by the shell (strategyarena-app.html)
   lives in localStorage that THIS file can read too — so no second login.
   If the visitor is NOT logged in, every helper simply no-ops quietly
   (so the curriculum/arenas still work standalone for anonymous readers).

   USAGE in a host file:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="sa-progress.js"></script>
     ... then call, e.g.:
     IMProgress.recordQuiz(6, 80, true);
     IMProgress.markReadingDone(6);
     IMProgress.recordArena('cooperative', 0.82, 'win', { rounds: 10 });

   No optional chaining / nullish coalescing (Safari-safe), all logic here.
   ====================================================================== */
(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://rtaiivegcqqmdchpguzn.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_KCPCMiKYQoEUgG45DVF5uA_ke-UxQKm';

  // Guard: if the supabase-js CDN script is missing, expose no-op helpers so
  // host pages never crash.
  if (!global.supabase || !global.supabase.createClient) {
    global.IMProgress = makeNoop('supabase-js not loaded');
    global.SAProgress = global.IMProgress;
    return;
  }

  var sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  try { console.log('%cim-progress build: micro-2026-08-reading-robust | project: ' + SUPABASE_URL, 'color:#0f3d9e;font-weight:bold'); } catch (e) {}

  // Cached identity, resolved once.
  var ready = null;          // a Promise resolving to { user, courseId } or null
  var ctx = null;            // resolved context once known

  function resolveContext() {
    if (ready) { return ready; }
    ready = sb.auth.getSession().then(function (res) {
      var session = (res && res.data) ? res.data.session : null;
      if (!session || !session.user) { ctx = null; return null; }
      var user = session.user;
      // Resolve the student's PRIMARY course the SAME way the app shell does, so
      // reading/quiz writes land on the course the progress view reads from.
      // Preference: a professor's course the student joined, else their self-study
      // course, else any enrollment. (The shell uses payCourseId || selfCourseId,
      // where payCourseId is the professor course when joined.)
      return sb.from('im_enrollment').select('course_id,status')
        .eq('student_id', user.id).eq('status','active')
        .then(function (enr) {
          var rows = (enr && enr.data) ? enr.data : [];
          var cids = rows.map(function(r){ return r.course_id; });
          if (cids.length === 0) { ctx = { user: user, courseId: null }; return ctx; }
          // Fetch owners separately (no PostgREST embed, which returns empty on
          // this project's data). Prefer a professor course, else self-study, else any.
          return sb.from('im_course').select('id,owner_id').in('id', cids)
            .then(function (cr) {
              var ownerById = {}; (cr.data || []).forEach(function (c) { ownerById[c.id] = c.owner_id; });
              var profCourse = null, selfCourse = null, anyCourse = null, i;
              for (i = 0; i < rows.length; i++) {
                anyCourse = rows[i].course_id;
                var oc = ownerById[rows[i].course_id] || null;
                if (oc === user.id) { selfCourse = rows[i].course_id; }
                else if (oc && !profCourse) { profCourse = rows[i].course_id; }
              }
              var courseId = profCourse ? profCourse : (selfCourse ? selfCourse : anyCourse);
              ctx = { user: user, courseId: courseId };
              return ctx;
            });
        });
    }).catch(function () { ctx = null; return null; });
    return ready;
  }

  // ---- Public helpers --------------------------------------------------

  // Upsert reading completion for a chapter.
  function markReadingDone(chapter) {
    return resolveContext().then(function (c) {
      if (!c || !c.courseId) {
        try { console.warn('im-progress: reading NOT saved for ch ' + chapter + ' -- no logged-in student or no resolved course.'); } catch (e) {}
        return null;
      }
      return sb.from('im_chapter_progress').upsert({
        student_id: c.user.id,
        course_id: c.courseId,
        chapter: chapter,
        reading_done: true
      }, { onConflict: 'student_id,course_id,chapter' }).then(function (r) {
        if (r && r.error) { try { console.warn('im-progress: reading save FAILED for ch ' + chapter + ': ' + r.error.message); } catch (e) {} }
        else { try { console.log('im-progress: reading saved for ch ' + chapter + ' (course ' + c.courseId + ')'); } catch (e) {} }
        return r;
      });
    }).catch(function (e) {
      try { console.warn('im-progress: reading save threw for ch ' + chapter + ': ' + (e && e.message ? e.message : e)); } catch (er) {}
      return null;
    });
  }

  // Record a quiz result (score is 0..100 percent here; stored as 0..1 fraction).
  function recordQuiz(chapter, percent, passed) {
    return resolveContext().then(function (c) {
      if (!c || !c.courseId) { return null; }
      var frac = (typeof percent === 'number') ? (percent / 100) : null;
      return sb.from('im_chapter_progress').upsert({
        student_id: c.user.id,
        course_id: c.courseId,
        chapter: chapter,
        quiz_score: frac,
        quiz_passed: passed === true
        // NOTE: reading_done is intentionally NOT set here. Reading credit must be
        // earned in the reader (coverage + dwell + comprehension checkpoints), so
        // taking a quiz can no longer shortcut the reading grade.
      }, { onConflict: 'student_id,course_id,chapter' });
    }).catch(function () { return null; });
  }

  // Record ONE arena case (a single scored question) to im_attempt. This is the
  // shape the instructor gradebook reads: one row per case, with is_correct, so a
  // student's arena score = fraction of that arena's cases they got right.
  // Columns match the live im_attempt: user_id, arena_slug, case_index,
  // is_correct, course_id, created_at (server default). Writes fail-soft and
  // report to the console instead of throwing.
  function recordArenaCase(slug, caseIndex, isCorrect, attemptNo, review) {
    return resolveContext().then(function (c) {
      if (!c) {
        try { console.warn('im-progress: arena case NOT saved (' + slug + ') -- no logged-in student.'); } catch (e) {}
        return null;
      }
      var row = {
        user_id: c.user.id,
        arena_slug: String(slug),
        case_index: (typeof caseIndex === 'number') ? caseIndex : null,
        is_correct: !!isCorrect,
        course_id: c.courseId   // may be null; column is nullable
      };
      if (typeof attemptNo === 'number' && attemptNo >= 1) { row.attempt_no = Math.floor(attemptNo); }
      if (review && typeof review === 'object') {
        if (review.prompt_text) { row.prompt_text = String(review.prompt_text).slice(0, 2000); }
        if (review.chosen_label) { row.chosen_label = String(review.chosen_label).slice(0, 500); }
        if (review.correct_label) { row.correct_label = String(review.correct_label).slice(0, 500); }
      }
      return sb.from('im_attempt').insert(row).then(function (r) {
        if (r && r.error) { try { console.warn('im-progress: arena case save FAILED (' + slug + '): ' + r.error.message); } catch (e) {} }
        else { try { console.log('im-progress: arena case saved (' + slug + ', correct=' + (!!isCorrect) + ')'); } catch (e) {} }
        return r;
      });
    }).catch(function (e) {
      try { console.warn('im-progress: arena case threw (' + slug + '): ' + (e && e.message ? e.message : e)); } catch (er) {}
      return null;
    });
  }

  // Back-compat convenience: record a whole session as a single "case". Some
  // arenas may call recordArena(slug, score, outcome) once at the end; treat a
  // score >= 0.5 (or outcome 'win') as a correct case so it still lands in
  // im_attempt. Per-case recording via recordArenaCase is preferred.
  function recordArena(slug, score, outcome, detail) {
    var ok = (typeof score === 'number') ? (score >= 0.5)
           : (outcome === 'win' || outcome === 'correct' || outcome === true);
    return recordArenaCase(slug, null, ok);
  }

  // Record a completed ATTEMPT summary (attempt number, that attempt's fraction,
  // and the running average). The gradebook computes the arena grade from the
  // per-case rows, so this is a best-effort summary for display/telemetry; it
  // never throws. If a summary table isn't present it simply no-ops after
  // logging, keeping the arena working.
  function recordArenaAttempt(slug, attemptNo, attemptFrac, averageFrac) {
    return resolveContext().then(function (c) {
      if (!c) { return null; }
      try {
        console.log('im-progress: arena attempt ' + attemptNo + ' for ' + slug +
          ' = ' + Math.round((attemptFrac || 0) * 100) + '% (avg ' +
          Math.round((averageFrac || 0) * 100) + '%)');
      } catch (e) {}
      // The authoritative grade comes from the per-case im_attempt rows already
      // written during play, which the gradebook averages. No separate write is
      // required here; kept as a hook so a summary table can be added later
      // without touching the arenas.
      return null;
    }).catch(function () { return null; });
  }

  // Lightweight telemetry (optional). No telemetry table in this project, so this
  // is a safe no-op; kept so callers don't break.
  function logEvent(eventType, fields) {
    return Promise.resolve(null);
  }

  // Is someone logged in? (resolves to boolean) — handy for host UIs.
  function isSignedIn() {
    return resolveContext().then(function (c) { return !!c; });
  }

  // ---- Universal arena session auto-reporter ---------------------------
  // An arena calls IMProgress.initArena({ slug, getSession }) once at load.
  //   slug       : the arena's slug (e.g. 'cooperative')
  //   getSession : a function returning { score, outcome, detail } at any time,
  //                reading from that arena's own State. May return null if the
  //                student never actually engaged (we skip empty sessions).
  // We report exactly once, when the page is hidden/closed, so it works for
  // both match-style and open-ended explorer arenas without bespoke hooks.
  function initArena(opts) {
    if (!opts || !opts.slug || typeof opts.getSession !== 'function') { return; }
    var recorded = false;     // ensure AT MOST ONE row per arena session

    // Record the LATEST meaningful session exactly once. Called at leave-time or
    // via an explicit finish trigger -- NOT on a per-round interval, so a 10-round
    // game produces a single result row (its final score), not one row per round.
    function flush() {
      if (recorded) { return; }
      var snap;
      try { snap = opts.getSession(); } catch (e) { snap = null; }
      if (!snap) { return; }                 // nothing meaningful yet — skip
      recorded = true;
      var score = (snap.score !== undefined && snap.score !== null) ? snap.score : null;
      var outcome = snap.outcome ? snap.outcome : 'completed';
      var detail = snap.detail ? snap.detail : null;
      recordArena(opts.slug, score, outcome, detail);
    }

    // Record when the player leaves the arena (best effort) OR when the game
    // explicitly signals completion via IMProgress.reportArenaNow(). We do NOT
    // poll during play: polling recorded a fresh row every time the score
    // changed, so a single match created many rows.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { flush(); }
    });
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    // Explicit "match complete" trigger the game can call for a reliable, timely
    // single write (recommended: call IMProgress.reportArenaNow() at match end).
    global.IMProgress.reportArenaNow = flush;
  }

  function makeNoop(reason) {
    function noop() { return Promise.resolve(null); }
    return {
      markReadingDone: noop, recordQuiz: noop, recordArena: noop, recordArenaCase: noop, recordArenaAttempt: noop,
      logEvent: noop, isSignedIn: function () { return Promise.resolve(false); },
      initArena: function () {}, reportArenaNow: function () {},
      trackReading: function () {}, _disabled: reason
    };
  }

  /* ====================================================================
     READING ENFORCEMENT
     --------------------------------------------------------------------
     Reading completion is EARNED, not self-declared. A chapter only counts
     as read when the student has genuinely gone through it:
       (1) COVERAGE: every section of the chapter must actually scroll into
           view (tracked per-section via IntersectionObserver). Jumping to
           the bottom does not reveal the middle sections, so it fails.
       (2) DWELL: cumulative *active* time on the chapter must reach a floor
           scaled to the chapter's length (you cannot read a 20-min chapter
           in 30 seconds). Time only accrues while the tab is visible.
     Only when BOTH are satisfied do we call markReadingDone(chapter).
     A small floating indicator shows live progress so the student knows
     what remains. Caller invokes IMProgress.trackReading(chapterEl, n, mins).
     ==================================================================== */
  var _activeTracker = null;

  // ---- Auto-generated comprehension checkpoints ------------------------
  // Reading credit now also requires answering a short check on each section,
  // generated from that section's own text (fill-in-the-blank on a key term).
  // The student must answer CORRECTLY (retries allowed; a wrong answer swaps in a
  // different term from the same section, so it can't be brute-forced blindly).
  var RC_STOP = {};
  (function () {
    var w = ("the a an of to in on at for and or but is are was were be been being this that these those " +
      "it its as by with from into than then so such not no can will would should could may might must " +
      "we you they he she i our your their his her them us also more most very much many few some any all " +
      "which who whom whose what when where why how if because while about over under between each other").split(" ");
    for (var k = 0; k < w.length; k++) { RC_STOP[w[k]] = 1; }
  })();

  function rcClean(t) { return (t || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); }

  function rcSentences(text) {
    var m = rcClean(text).match(/[^.!?]+[.!?]+/g);
    if (!m) { var t = rcClean(text); return t ? [t] : []; }
    return m.map(function (x) { return rcClean(x); }).filter(function (x) { return x.length > 0; });
  }

  // Escape a term for a case-insensitive whole-phrase regex.
  function rcEsc(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // Collect, per section index, a list of { term, sentence } candidates. Terms
  // are the emphasised key phrases the textbook already marks up (<b>,<strong>,
  // <dfn>,<mark>). Each emphasised node is bucketed under the nearest preceding
  // section heading, so the check for a section is drawn from that section only.
  function rcSectionTerms(chapterEl, sections) {
    var buckets = [];
    var si;
    for (si = 0; si < sections.length; si++) { buckets.push([]); }
    var emph = [].slice.call(chapterEl.querySelectorAll("b, strong, dfn, mark"));
    // DOM order of all headings so we can map an emphasised node to its section.
    var order = [].slice.call(chapterEl.querySelectorAll("h2, h3, b, strong, dfn, mark"));
    var curSection = -1;
    var seenTerm = {};
    for (var i = 0; i < order.length; i++) {
      var node = order[i];
      var tag = node.tagName ? node.tagName.toLowerCase() : "";
      if (tag === "h2" || tag === "h3") {
        var idx = sections.indexOf(node);
        if (idx >= 0) { curSection = idx; }
        continue;
      }
      if (curSection < 0) { continue; }
      var term = rcClean(node.textContent || "");
      if (term.length < 3 || term.length > 42) { continue; }
      if (/[0-9]/.test(term)) { continue; }              // drop quantities/results/years
      if (/[=$%\u2588]/.test(term)) { continue; }        // drop formula-ish emphasis
      // Real key terms are short; glossary (tb-keyterm) terms may be a touch longer.
      var inKeyterm = false;
      try { inKeyterm = !!(node.closest && node.closest(".tb-keyterm")); } catch (e0) { inKeyterm = false; }
      var words = term.split(" ");
      if (!inKeyterm && words.length > 4) { continue; }
      // reject phrases that are ALL common/stop words (e.g. "any other")
      var contentful = false;
      for (var wi = 0; wi < words.length; wi++) {
        var wl = words[wi].toLowerCase().replace(/[^a-z]/g, "");
        if (wl && wl.length > 2 && !RC_STOP[wl]) { contentful = true; break; }
      }
      if (!contentful) { continue; }
      var key = term.toLowerCase();
      if (seenTerm[key]) { continue; }         // one checkpoint per distinct term
      seenTerm[key] = 1;
      // find a sentence in the surrounding paragraph that contains the term
      var host = node.parentNode;
      var paraText = host ? (host.textContent || "") : term;
      var sents = rcSentences(paraText);
      var sentence = "";
      var re = new RegExp("\\b" + rcEsc(term) + "\\b", "i");
      for (var q = 0; q < sents.length; q++) { if (re.test(sents[q])) { sentence = sents[q]; break; } }
      if (!sentence) { continue; }             // need a usable sentence
      if (sentence.length < 25 || sentence.length > 320) { continue; }
      var entry = { term: term, sentence: sentence };
      // Prefer authoritative glossary terms: put them first in the section bucket.
      if (inKeyterm) { buckets[curSection].unshift(entry); } else { buckets[curSection].push(entry); }
    }
    return buckets;
  }

  function rcShuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // Build one MC fill-in-the-blank from a { term, sentence } plus a chapter-wide
  // pool of other terms for distractors. Returns null if it can't build a fair one.
  function rcBuildCheck(cand, pool) {
    if (!cand) { return null; }
    var re = new RegExp("\\b" + rcEsc(cand.term) + "\\b", "gi");
    var blanked = cand.sentence.replace(re, "\u2588\u2588\u2588\u2588\u2588");
    if (blanked === cand.sentence) { return null; }
    var lower = cand.term.toLowerCase();
    var distract = [];
    var seen = {}; seen[lower] = 1;
    var shuffled = rcShuffle(pool.slice());
    for (var i = 0; i < shuffled.length && distract.length < 3; i++) {
      var d = shuffled[i]; var dl = d.toLowerCase();
      if (seen[dl]) { continue; }
      // avoid near-duplicates / substrings of the answer
      if (dl.indexOf(lower) >= 0 || lower.indexOf(dl) >= 0) { continue; }
      seen[dl] = 1; distract.push(d);
    }
    if (distract.length < 3) { return null; }   // not enough plausible distractors
    var opts = distract.concat([cand.term]);
    rcShuffle(opts);
    var ansIdx = -1;
    for (var o = 0; o < opts.length; o++) { if (opts[o].toLowerCase() === lower) { ansIdx = o; } }
    return { blanked: blanked, options: opts, answerIdx: ansIdx };
  }

  // True when the page is being driven by browser automation. Not foolproof, but
  // it catches the common headless/WebDriver agents and lets us withhold credit.
  function rcAutomated() {
    try {
      if (navigator && navigator.webdriver === true) { return true; }
      if (window.__nightmare || window._phantom || window.callPhantom) { return true; }
      if (navigator && /HeadlessChrome/.test(navigator.userAgent || "")) { return true; }
    } catch (e) {}
    return false;
  }

  var _activeTracker = null;

  // Tuning knobs for the reading gate.
  var RC_WPM = 320;            // assumed FAST reader; real students are slower
  var RC_FRAC = 0.85;          // must spend this fraction of a fast read, per section
  var RC_SEC_MIN_MS = 12000;   // floor per non-trivial section
  var RC_SEC_MAX_MS = 240000;  // cap per section (4 min)
  var RC_TRIVIAL_WORDS = 25;   // below this a section is trivial (no check, tiny dwell)
  var RC_IDLE_MS = 120000;     // time only accrues if a real interaction happened this recently

  // Gather a section's own text (siblings after its heading, up to the next
  // heading) and its emphasised terms, so we can word-count it and build a check.
  function rcSectionContent(headingEl) {
    var words = 0; var text = ""; var terms = [];
    var n = headingEl.nextElementSibling;
    while (n && n.tagName && !/^H[23]$/.test(n.tagName)) {
      var tc = rcClean(n.textContent || "");
      if (tc) { text += " " + tc; }
      var em = [].slice.call(n.querySelectorAll ? n.querySelectorAll("b, strong, dfn, mark") : []);
      if (n.tagName && /^(B|STRONG|DFN|MARK)$/.test(n.tagName)) { em.push(n); }
      for (var e = 0; e < em.length; e++) {
        var t = rcClean(em[e].textContent || "");
        var inKey = false; try { inKey = !!(em[e].closest && em[e].closest(".tb-keyterm")); } catch (e1) {}
        terms.push({ term: t, node: em[e], inKeyterm: inKey });
      }
      n = n.nextElementSibling;
    }
    text = rcClean(text);
    words = text ? text.split(" ").length : 0;
    return { text: text, words: words, terms: terms };
  }

  // Prose fallback: blank a salient (long, non-stopword) word from the section's
  // longest sentence, so EVERY prose section gets a real question even when it has
  // no emphasised key term. Distractors are other salient words from the chapter.
  function rcProseCheck(sectionText, wordPool) {
    var sents = rcSentences(sectionText);
    var best = "";
    for (var i = 0; i < sents.length; i++) {
      if (sents[i].length >= 40 && sents[i].length <= 220 && sents[i].length > best.length) { best = sents[i]; }
    }
    if (!best) { return null; }
    var toks = best.split(/\s+/);
    var cand = "";
    for (var t = 0; t < toks.length; t++) {
      var raw = toks[t].replace(/[^A-Za-z-]/g, "");
      if (raw.length >= 5 && !RC_STOP[raw.toLowerCase()] && raw.length > cand.length) { cand = raw; }
    }
    if (!cand) { return null; }
    return rcBuildCheck({ term: cand, sentence: best }, wordPool);
  }

  function rcSalientWords(text) {
    var out = []; var seen = {};
    var toks = rcClean(text).split(/\s+/);
    for (var i = 0; i < toks.length; i++) {
      var w = toks[i].replace(/[^A-Za-z-]/g, "");
      if (w.length >= 5 && !RC_STOP[w.toLowerCase()]) { var k = w.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(w); } }
    }
    return out;
  }

  function trackReading(chapterEl, chapterNum, estMinutes) {
    if (!chapterEl || !chapterNum) { return; }
    if (_activeTracker && _activeTracker.teardown) { _activeTracker.teardown(); }

    var heads = [].slice.call(chapterEl.querySelectorAll("h2, h3"));
    if (heads.length === 0) { heads = [chapterEl]; }

    // Build per-section info: word count, required dwell, and a comprehension check.
    var termPool = [];   // chapter-wide emphasised terms (for distractors)
    var wordPool = [];   // chapter-wide salient words (fallback distractors)
    var secs = [];
    var seenPool = {};
    var s;
    for (s = 0; s < heads.length; s++) {
      var info = rcSectionContent(heads[s]);
      secs.push({ el: heads[s], words: info.words, text: info.text, terms: info.terms });
      for (var ti = 0; ti < info.terms.length; ti++) {
        var tt = info.terms[ti].term;
        if (tt && tt.length >= 3 && tt.length <= 42 && !/[0-9=$%]/.test(tt)) {
          var lk = tt.toLowerCase();
          if (!seenPool[lk]) { seenPool[lk] = 1; termPool.push(tt); }
        }
      }
      var sw = rcSalientWords(info.text);
      for (var wi = 0; wi < sw.length; wi++) { wordPool.push(sw[wi]); }
    }

    // Required dwell per section from its own word count (fast-reader model).
    var totalReq = 0;
    for (s = 0; s < secs.length; s++) {
      var w = secs[s].words;
      if (w < RC_TRIVIAL_WORDS) { secs[s].reqMs = 4000; secs[s].trivial = true; }
      else {
        var ms = Math.round(w / RC_WPM * 60000 * RC_FRAC);
        secs[s].reqMs = Math.max(RC_SEC_MIN_MS, Math.min(RC_SEC_MAX_MS, ms));
        secs[s].trivial = false;
      }
      secs[s].dwell = 0; secs[s].seen = false; secs[s].passed = false; secs[s].attempt = 0; secs[s].shown = false;
      totalReq += secs[s].reqMs;
    }

    // Build a check for each non-trivial section (term cloze preferred, prose fallback).
    var distractPool = termPool.length >= 4 ? termPool : termPool.concat(wordPool);
    for (s = 0; s < secs.length; s++) {
      if (secs[s].trivial) { secs[s].check = null; continue; }
      var built = null;
      // term-based candidates first (glossary terms already sorted to front by proximity)
      var cands = [];
      for (var c = 0; c < secs[s].terms.length; c++) {
        var trm = secs[s].terms[c].term;
        if (!trm || trm.length < 3 || trm.length > 42 || /[0-9=$%]/.test(trm)) { continue; }
        var re = new RegExp("\\b" + rcEsc(trm) + "\\b", "i");
        var sents = rcSentences(secs[s].text); var sent = "";
        for (var q = 0; q < sents.length; q++) { if (re.test(sents[q])) { sent = sents[q]; break; } }
        if (sent && sent.length >= 25 && sent.length <= 320) {
          if (secs[s].terms[c].inKeyterm) { cands.unshift({ term: trm, sentence: sent }); }
          else { cands.push({ term: trm, sentence: sent }); }
        }
      }
      secs[s].cands = cands;
      for (var ci = 0; ci < cands.length && !built; ci++) { built = rcBuildCheck(cands[ci], distractPool); }
      if (!built) { built = rcProseCheck(secs[s].text, distractPool); }
      secs[s].check = built;                 // may still be null -> time-gated confirm
    }

    var floorMs = Math.max(45000, totalReq);
    var lastTick = Date.now();
    var lastHuman = Date.now();
    var humanHits = 0;
    var automated = rcAutomated();
    var done = false, recorded = false;
    var cur = 0;                              // sequential: first incomplete section
    var totalActive = 0;

    var ind = document.createElement("div");
    ind.setAttribute("data-sa-reading-indicator", "1");
    ind.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99999;background:#1b1340;color:#F0EEFA;border:1px solid rgba(155,123,255,.4);border-radius:12px;padding:12px 14px;font:12.5px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);max-width:320px;";
    document.body.appendChild(ind);

    function nDone() { var k = 0; for (var i = 0; i < secs.length; i++) { if (secs[i].passed) { k++; } } return k; }
    function pctv(x) { return Math.max(0, Math.min(100, Math.round(x * 100))); }

    function paint(msg) {
      var i = Math.min(cur, secs.length - 1);
      var secProg = secs[i] ? (secs[i].dwell / secs[i].reqMs) : 1;
      var overall = nDone() / secs.length;
      var head = secs[i] && secs[i].el ? rcClean(secs[i].el.textContent || ("Section " + (i + 1))) : ("Section " + (i + 1));
      var autoNote = automated ? '<div style="color:#fca5a5;margin-top:6px;">Automated browser detected \u2014 reading credit is disabled.</div>' : "";
      ind.innerHTML =
        '<b>Reading Chapter ' + chapterNum + '</b>' +
        '<div style="margin-top:5px;opacity:.85;">Section ' + (i + 1) + ' of ' + secs.length + ": " + rcEscHtml(head.slice(0, 46)) + "</div>" +
        '<div style="margin-top:6px;">Time on this section</div>' +
        '<div style="height:6px;background:rgba(255,255,255,.12);border-radius:3px;margin:3px 0 6px;overflow:hidden;"><div style="height:100%;width:' + pctv(secProg) + '%;background:#FBBF24;"></div></div>' +
        '<div>Sections completed: ' + nDone() + " / " + secs.length + "</div>" +
        '<div style="height:6px;background:rgba(255,255,255,.12);border-radius:3px;margin:3px 0 0;overflow:hidden;"><div style="height:100%;width:' + pctv(overall) + '%;background:#34d399;"></div></div>' +
        (msg ? '<div style="margin-top:7px;color:#c4b5fd;">' + msg + "</div>" : "") +
        autoNote;
    }

    function showDone() {
      ind.innerHTML = '<b style="color:#34d399;">\u2713 Chapter ' + chapterNum + ' read</b><div style="opacity:.85;margin-top:2px;">Reading credit saved.</div>';
    }

    function showCheck(i) {
      var sc = secs[i];
      sc.shown = true;
      var built = sc.check;
      if (!built) {
        // No generatable question: fall back to a time-gated confirm (dwell already met).
        var head2 = rcClean(sc.el.textContent || ("Section " + (i + 1)));
        ind.innerHTML = '<b>Reading check</b><div style="margin:6px 0;">You\u2019ve spent enough time on \u201C' + rcEscHtml(head2.slice(0, 40)) + '\u201D.</div>';
        var okb = document.createElement("button");
        okb.textContent = "I\u2019ve read this section \u2014 continue";
        okb.style.cssText = "display:block;width:100%;margin-top:6px;padding:9px 10px;border:1px solid rgba(155,123,255,.5);border-radius:8px;background:#241a54;color:#F0EEFA;font:13px system-ui,sans-serif;cursor:pointer;";
        okb.addEventListener("click", function () { sc.passed = true; cur = i + 1; pump(); });
        ind.appendChild(okb);
        return;
      }
      var html = '<div style="font-weight:700;color:#c4b5fd;margin-bottom:4px;">Reading check \u2014 Section ' + (i + 1) + '</div>' +
        '<div style="margin-bottom:8px;">Fill in the blank from what you just read:</div>' +
        '<div style="background:rgba(255,255,255,.06);border-radius:8px;padding:9px 11px;margin-bottom:10px;color:#e9e6fb;">' + rcEscHtml(built.blanked) + "</div>";
      ind.innerHTML = html;
      var fb = document.createElement("div"); fb.style.cssText = "margin-top:8px;min-height:1em;font-size:12px;";
      built.options.forEach(function (opt, oi) {
        var btn = document.createElement("button");
        btn.textContent = opt;
        btn.style.cssText = "display:block;width:100%;text-align:left;margin:5px 0;padding:8px 10px;border:1px solid rgba(155,123,255,.4);border-radius:8px;background:#241a54;color:#F0EEFA;font:13px system-ui,sans-serif;cursor:pointer;";
        btn.addEventListener("click", function () {
          if (oi === built.answerIdx) { sc.passed = true; cur = i + 1; pump(); }
          else {
            sc.attempt++;
            // swap in a different question (next term candidate, else a fresh prose cloze)
            var nb = null;
            if (sc.cands && sc.cands.length > sc.attempt) { nb = rcBuildCheck(sc.cands[sc.attempt], distractPool); }
            if (!nb) { nb = rcProseCheck(sc.text, distractPool); }
            if (nb) { sc.check = nb; }
            fb.innerHTML = '<span style="color:#fca5a5;">Not quite \u2014 re-read this section and try again.</span>';
            setTimeout(function () { if (cur === i && !sc.passed) { sc.shown = true; showCheck(i); } }, 1000);
          }
        });
        ind.appendChild(btn);
      });
      ind.appendChild(fb);
    }

    function pump() {
      if (done) { return; }
      if (automated) { paint(""); return; }
      if (cur >= secs.length) { maybeComplete(); return; }
      var sc = secs[cur];
      if (!sc.seen) { paint("Scroll down to section " + (cur + 1) + " to continue."); return; }
      if (sc.dwell < sc.reqMs) { paint("Keep reading this section\u2026"); return; }
      if (sc.trivial) { sc.passed = true; cur = cur + 1; pump(); return; }
      if (sc.passed) { cur = cur + 1; pump(); return; }
      if (!sc.shown) { showCheck(cur); return; }
      // else: a checkpoint is on screen awaiting a correct answer
    }

    function maybeComplete() {
      if (done || automated) { return; }
      if (humanHits < Math.max(3, Math.min(secs.length, 6))) { paint("Interact with the page to continue."); return; }
      for (var i = 0; i < secs.length; i++) { if (!secs[i].passed) { return; } }
      if (totalActive < floorMs) { return; }
      done = true; showDone();
      if (!recorded) { recorded = true; markReadingDone(chapterNum); }
      setTimeout(function () { if (ind && ind.parentNode) { ind.style.transition = "opacity .6s"; ind.style.opacity = "0"; setTimeout(function () { if (ind.parentNode) { ind.parentNode.removeChild(ind); } }, 700); } }, 4500);
    }

    // coverage
    var io = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            for (var i = 0; i < secs.length; i++) { if (secs[i].el === e.target) { secs[i].seen = true; } }
            pump();
          }
        });
      }, { threshold: 0.4 });
      for (s = 0; s < secs.length; s++) { io.observe(secs[s].el); }
    } else {
      for (s = 0; s < secs.length; s++) { secs[s].seen = true; }
    }

    function onHuman(ev) { if (ev && ev.isTrusted) { humanHits++; lastHuman = Date.now(); } }
    document.addEventListener("pointerdown", onHuman, true);
    document.addEventListener("keydown", onHuman, true);
    document.addEventListener("wheel", onHuman, { capture: true, passive: true });
    document.addEventListener("touchstart", onHuman, { capture: true, passive: true });
    document.addEventListener("mousemove", onHuman, { capture: true, passive: true });

    var timer = setInterval(function () {
      var now = Date.now();
      var elapsed = now - lastTick; lastTick = now;
      var active = (document.visibilityState === "visible") && ((now - lastHuman) <= RC_IDLE_MS);
      if (active) {
        totalActive += elapsed;
        if (cur < secs.length && secs[cur].seen && !secs[cur].passed) { secs[cur].dwell += elapsed; }
      }
      pump();
    }, 1000);
    function onVis() { lastTick = Date.now(); }
    document.addEventListener("visibilitychange", onVis);

    pump();

    _activeTracker = {
      teardown: function () {
        if (io) { io.disconnect(); }
        clearInterval(timer);
        document.removeEventListener("visibilitychange", onVis);
        document.removeEventListener("pointerdown", onHuman, true);
        document.removeEventListener("keydown", onHuman, true);
        document.removeEventListener("wheel", onHuman, true);
        document.removeEventListener("touchstart", onHuman, true);
        document.removeEventListener("mousemove", onHuman, true);
        if (ind && ind.parentNode) { ind.parentNode.removeChild(ind); }
        _activeTracker = null;
      }
    };
  }

  function rcEscHtml(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  global.IMProgress = {
    markReadingDone: markReadingDone,
    recordQuiz: recordQuiz,
    recordArena: recordArena,
    recordArenaCase: recordArenaCase,
    recordArenaAttempt: recordArenaAttempt,
    logEvent: logEvent,
    isSignedIn: isSignedIn,
    initArena: initArena,
    trackReading: trackReading,
    _client: sb
  };
  // Back-compat: the textbook and arenas were written to call SAProgress.* and
  // may load this as sa-progress.js. Keep that name working so this file is a
  // drop-in replacement -- no edits needed in the textbook/arena HTML.
  global.SAProgress = global.IMProgress;
})(window);
