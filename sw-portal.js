/* ==========================================================================
   Sheetwise for the Intro Micro portal  --  bubble-sheet paper exams.  v2
   Adapter between SheetwiseCore (layout / print / optical reading) and this
   portal's data: im_exam, im_assessment_item, IMGenerators, im_paper_sheet
   (im_77) and im_manual_exam_score (im_71, which feeds the gradebook).

   Two ways to issue an exam:
     * VERSIONS (default)  -- K booklet versions (different numbers, question
       order and option order). Each version prints as ONE master booklet, so
       the copier makes N stapled copies. Every student gets a one-page named
       answer sheet with a "booklet version" bubble row.
     * PER STUDENT         -- a unique booklet for every student (small classes).

   Uses portal globals: sb, State, esc, renderFigure, IMGenerators,
   IMDiagrams, loadExams, loadingCard.  Safari-safe ES5, ASCII only.
   ========================================================================== */
(function () {
  'use strict';
  var SW_BUILD = 'sw-portal-3.0';
  // Scan libraries: served next to index.html first (same origin, no CDN or
  // worker cross-origin issues); CDN only as a fallback.
  var LIBS = {
    jsqr: ['sw-jsqr.js', 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'],
    pdf: ['sw-pdf.min.js', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js'],
    pdfWorker: ['sw-pdf.worker.min.js', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js']
  };
  var CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var S = null;   // state of the open modal

  /* ------------------------------------------------------------ helpers */
  function h(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function el(id) { return document.getElementById(id); }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function loadFirst(list, ok) {
    var i = 0;
    function next() {
      if (i >= list.length) { return Promise.reject(new Error('Could not load ' + list[0] + ' (also tried the CDN). Check that it was uploaded next to index.html.')); }
      var src = list[i++];
      return loadScript(src).then(function () { if (ok()) { return src; } return next(); }, next);
    }
    return next();
  }
  function absUrl(u) { try { return new URL(u, document.baseURI).href; } catch (e) { return u; } }
  function ensureScanLibs() {
    var p = [];
    if (typeof window.jsQR !== 'function') { p.push(loadFirst(LIBS.jsqr, function () { return typeof window.jsQR === 'function'; })); }
    if (!window.pdfjsLib) {
      p.push(loadFirst(LIBS.pdf, function () { return !!window.pdfjsLib; }).then(function (src) {
        var local = src.indexOf('http') !== 0;
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = absUrl(local ? LIBS.pdfWorker[0] : LIBS.pdfWorker[1]);
      }));
    }
    return Promise.all(p);
  }
  function newCode() {
    var a = new Uint8Array(7), s = '';
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (var i = 0; i < a.length; i++) { s += CODE_ALPHA.charAt(a[i] % CODE_ALPHA.length); }
    return s;
  }
  function randSeed() {
    var a = new Uint32Array(1); (window.crypto || window.msCrypto).getRandomValues(a);
    return (a[0] % 2000000000) + 1;
  }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // Display order of options: perm[displayed] = original index. Deterministic from the seed.
  function makePerm(n, seed) {
    var r = mulberry((Number(seed) ^ 0x5bd1e995) >>> 0), p = [];
    for (var i = 0; i < n; i++) { p.push(i); }
    for (i = n - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = p[i]; p[i] = p[j]; p[j] = t; }
    return p;
  }
  function shuffle(arr) { for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
  function chunk(arr, n) { var o = []; for (var i = 0; i < arr.length; i += n) { o.push(arr.slice(i, i + n)); } return o; }
  function say(id, text, kind) { var m = el(id); if (!m) { return; } m.style.display = text ? 'block' : 'none'; m.className = 'msg' + (kind ? ' ' + kind : ''); m.textContent = text || ''; }
  function stripLetter(o) { return String(o == null ? '' : o).replace(/^[A-Z][\).]\s*/, ''); }
  function letter(i) { return String.fromCharCode(65 + i); }
  function letters(n) { var a = []; for (var i = 0; i < n; i++) { a.push(letter(i)); } return a; }
  function runSeq(list, fn) {
    var chain = Promise.resolve(), out = [];
    list.forEach(function (x, i) { chain = chain.then(function () { return fn(x, i); }).then(function (r) { out.push(r); }); });
    return chain.then(function () { return out; });
  }
  function kindOf(gen, item) {
    var k = gen && gen.kind ? gen.kind : null;
    if (!k) {
      var t = item.item_type;
      k = (t === 'multiple_choice' || t === 'mc') ? 'mc' : (t === 'parameterized_decision' || t === 'decision') ? 'decision'
        : (t === 'free_response' || t === 'short') ? 'short' : 'numeric';
    }
    if (k === 'mc') { return 'mc'; }
    if (k === 'decision') { return 'yn'; }
    if (k === 'short') { return 'short'; }
    return 'num';
  }
  function genFor(item, seed) {
    if (!item || !item.generator_id || typeof IMGenerators === 'undefined') { return null; }
    try { return IMGenerators.generate(item.generator_id, Number(seed)); } catch (e) { return null; }
  }
  function figureFor(gen) {
    if (!gen) { return null; }
    if (gen.figure && gen.figure.type) { return gen.figure; }
    if (gen.diagramSpec && typeof IMDiagrams !== 'undefined') {
      try { var svg = IMDiagrams.render(gen.diagramSpec); if (svg && svg.indexOf('<svg') >= 0) { return { type: 'svg', svg: svg }; } } catch (e) {}
    }
    return null;
  }

  /* ---------------------------------------------------- sheet model */
  // sheet.items is either an array (per-student sheet) or
  // { mode:'versions', labels:['A',..], versions:[[entry..], ..] }.
  function isVersioned(sheet) { return !!(sheet.items && !Array.isArray(sheet.items) && sheet.items.mode === 'versions'); }
  function versionSets(sheet) { return isVersioned(sheet) ? sheet.items.versions : [sheet.items || []]; }
  function itemsFor(sheet, v) { var sets = versionSets(sheet); return isVersioned(sheet) ? (v == null ? null : sets[v] || null) : sets[0]; }
  function layoutFor(sheet) {
    if (!sheet._layout) {
      var sets = versionSets(sheet), base = sets[0] || [];
      var qs = base.map(function (it, i) {
        var n = it.nopts || 0;
        for (var v = 1; v < sets.length; v++) { if (sets[v][i] && (sets[v][i].nopts || 0) > n) { n = sets[v][i].nopts; } }
        return { n: it.q, kind: it.kind, nopts: n };
      });
      sheet._layout = SheetwiseCore.layout(qs, { versions: isVersioned(sheet) ? sets.length : 0 });
    }
    return sheet._layout;
  }
  function examMode() {
    for (var i = 0; i < S.sheets.length; i++) { if (S.sheets[i].status !== 'void') { return isVersioned(S.sheets[i]) ? 'versions' : 'student'; } }
    return null;
  }

  /* ------------------------------------------------------------- open */
  function blockDrop(e) { e.preventDefault(); }
  function open(examId, title) {
    if (typeof SheetwiseCore === 'undefined') { alert('Sheetwise engine (sheetwise-core.js) did not load. Hard-refresh the page.'); return; }
    if (!State || !State.teachCourseId) { alert('Select a course first.'); return; }
    S = { examId: examId, title: title || 'Paper exam', courseId: State.teachCourseId, tab: 'setup',
      sheets: [], roster: [], rosterById: {}, sources: [], scan: null, keys: {} };
    var ov = document.createElement('div'); ov.className = 'modal-bg'; ov.id = 'swOverlay';
    ov.innerHTML = '<div class="modal" style="max-width:1020px;">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;"><h3 style="margin:0;flex:1;">Bubble sheets \u2014 ' + h(S.title) + '</h3>' +
      '<button class="btn btn-ghost btn-sm" id="swClose">Close</button></div>' +
      '<div class="inline-actions" id="swTabs" style="margin:10px 0 16px;">' +
      '<button class="btn btn-sm" data-swtab="setup">1 \u00b7 Questions &amp; printing</button>' +
      '<button class="btn btn-sm" data-swtab="scan">2 \u00b7 Scan &amp; grade</button>' +
      '<button class="btn btn-sm" data-swtab="results">3 \u00b7 Results &amp; review</button></div>' +
      '<div id="swBody"></div></div>';
    document.body.appendChild(ov);
    // A file dropped outside the drop box must not navigate away from the portal.
    window.addEventListener('dragover', blockDrop); window.addEventListener('drop', blockDrop);
    el('swClose').addEventListener('click', close);
    Array.prototype.forEach.call(ov.querySelectorAll('[data-swtab]'), function (b) {
      b.addEventListener('click', function () { show(b.getAttribute('data-swtab')); });
    });
    el('swBody').innerHTML = (typeof loadingCard === 'function') ? loadingCard() : 'Loading\u2026';
    loadBase().then(function () { show('setup'); }, function (err) {
      el('swBody').innerHTML = '<div class="msg err" style="display:block;">' + h(err && err.message ? err.message : String(err)) + '</div>';
    });
  }
  function close() {
    if (S && S.scan && S.scan.busy && !confirm('A scan is still being read. Close anyway?')) { return; }
    var ov = el('swOverlay'); if (ov && ov.parentNode) { ov.parentNode.removeChild(ov); }
    window.removeEventListener('dragover', blockDrop); window.removeEventListener('drop', blockDrop);
    S = null;
    if (typeof loadExams === 'function') { try { loadExams(); } catch (e) {} }
  }
  function show(tab) {
    S.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('#swTabs [data-swtab]'), function (b) {
      b.className = 'btn btn-sm ' + (b.getAttribute('data-swtab') === tab ? 'btn-primary' : 'btn-ghost');
    });
    if (tab === 'setup') { renderSetup(); } else if (tab === 'scan') { renderScan(); } else { renderResults(); }
  }

  /* ------------------------------------------------------------ data */
  function loadBase() {
    return Promise.all([
      sb.from('im_paper_sheet').select('*').eq('exam_id', S.examId).neq('status', 'void').order('student_label', { ascending: true }),
      sb.from('im_gradebook_v').select('student_id,email,full_name').eq('course_id', S.courseId),
      sb.from('im_enrollment').select('user_id,status').eq('course_id', S.courseId),
      sb.from('im_exam').select('id,title,kind,item_ids,random_per_student,random_recipe,shuffle_questions,is_manual,total_points').eq('course_id', S.courseId)
    ]).then(function (r) {
      if (r[0].error) { throw new Error(/relation|does not exist|schema cache/i.test(r[0].error.message) ? 'Bubble sheets aren\u2019t installed yet. Run im_77_paper_sheets.sql in the Supabase SQL editor, then reopen.' : r[0].error.message); }
      S.sheets = r[0].data || [];
      var active = null;
      if (!r[2].error && r[2].data) { active = {}; r[2].data.forEach(function (e) { if (e.status === 'active') { active[String(e.user_id)] = true; } }); }
      var seen = {};
      S.roster = (r[1].data || []).filter(function (st) {
        var id = String(st.student_id); if (seen[id]) { return false; } seen[id] = true;
        return !active || active[id];
      }).map(function (st) {
        var nm = st.full_name && st.full_name.indexOf('@') < 0 ? st.full_name : '';
        return { id: String(st.student_id), name: nm || st.email || 'Student', email: st.email || '' };
      });
      S.roster.sort(function (a, b) { var x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : (x > y ? 1 : 0); });
      S.rosterById = {}; S.roster.forEach(function (st) { S.rosterById[st.id] = st; });
      var exams = r[3].data || [];
      S.exam = null;
      S.sources = exams.filter(function (e) {
        if (String(e.id) === String(S.examId)) { S.exam = e; return false; }
        if (e.is_manual) { return false; }
        return (e.item_ids && e.item_ids.length) || (e.random_per_student && e.random_recipe && e.random_recipe.length);
      });
    });
  }

  /* ========================================================== TAB 1: setup */
  function renderSetup() {
    var live = S.sheets.filter(function (s) { return s.status !== 'void'; });
    var graded = live.filter(function (s) { return s.status === 'graded'; }).length;
    var spares = live.filter(function (s) { return !s.student_id; }).length;
    var mode = examMode();
    var opts = S.sources.map(function (e) {
      var n = e.random_per_student ? (e.random_recipe || []).reduce(function (a, r) { return a + (Number(r.n) || 0); }, 0) : (e.item_ids || []).length;
      return '<option value="' + h(e.id) + '">' + h(e.title) + ' \u2014 ' + n + ' questions' + (e.random_per_student ? ' (topic recipe)' : '') + '</option>';
    }).join('');
    var html = '';
    html += '<div class="card" style="margin-bottom:14px;">' +
      '<div style="font-weight:700;margin-bottom:4px;">' + (live.length ? live.length + ' answer sheets issued' + (mode === 'versions' ? ' \u00b7 ' + live[0].items.versions.length + ' booklet versions' : ' \u00b7 one booklet per student') : 'Nothing issued yet') + '</div>' +
      '<div style="font-size:12.5px;color:var(--text-muted);">' + (live.length ? (live.length - spares) + ' named \u00b7 ' + spares + ' spare \u00b7 ' + graded + ' graded' : 'Pick where the questions come from, then issue.') + '</div></div>';

    html += '<div class="card" style="margin-bottom:14px;">' +
      '<div style="font-weight:700;margin-bottom:10px;">Issue</div>' +
      (S.sources.length ? '' : '<div class="msg err" style="display:block;margin-bottom:10px;">No question source yet. Use \u201cAssemble exam\u201d to build the questions (leave it unpublished so students can\u2019t take it online), then come back here.</div>') +
      '<label class="fld">Questions come from<select id="swSrc">' + opts + '</select></label>' +
      '<label class="fld">How to print<select id="swMode">' +
      '<option value="versions">Booklet versions \u2014 copier prints &amp; staples each version (recommended)</option>' +
      '<option value="student">A different booklet for every student (small classes; no auto-staple)</option></select></label>' +
      '<div id="swVersRow" style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;">' +
      '<label class="fld" style="max-width:170px;">Number of versions<select id="swNV"><option>2</option><option>3</option><option selected>4</option><option>5</option><option>6</option><option>8</option></select></label>' +
      '<div style="font-size:12px;color:var(--text-muted);flex:1;min-width:240px;margin-bottom:10px;">Each version has its own numbers, question order and answer order. Hand them out so neighbours hold different letters.</div></div>' +
      '<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:6px 0;"><input type="checkbox" id="swShuffleQ" checked> <span>Shuffle question order (multiple-choice and numeric questions each stay in their own section)</span></label>' +
      '<div style="font-size:12px;color:var(--text-muted);margin:2px 0 8px;">Answer choices are always reshuffled, so the right answer isn\u2019t always A. Numbers change only on generated questions; fixed bank questions keep their wording and are reshuffled.</div>' +
      '<label class="fld" style="max-width:220px;">Spare (unnamed) answer sheets<input type="number" id="swSpares" min="0" max="60" value="6"></label>' +
      '<div style="font-size:12px;color:var(--text-subtle);margin:4px 0 10px;">Written (free-response) questions are left off. Students with a graded sheet keep it; everyone else gets a fresh one.</div>' +
      '<div class="inline-actions"><button class="btn btn-primary btn-sm" id="swIssue"' + (S.sources.length ? '' : ' disabled') + '>' + (live.length ? 'Re-issue' : 'Issue') + ' for ' + S.roster.length + ' students</button></div>' +
      '<div class="msg" id="swIssueMsg" style="display:none;margin-top:10px;"></div></div>';

    html += '<div class="card"><div style="font-weight:700;margin-bottom:10px;">Print</div><div id="swPrintBox"></div>' +
      '<div class="msg" id="swPrintMsg" style="display:none;margin-top:10px;"></div></div>';
    el('swBody').innerHTML = html;
    el('swMode').addEventListener('change', function () { el('swVersRow').style.display = el('swMode').value === 'versions' ? 'flex' : 'none'; });
    el('swIssue').addEventListener('click', issueSheets);
    renderPrintBox(mode, live);
  }

  function renderPrintBox(mode, live) {
    var box = el('swPrintBox');
    if (!live.length) { box.innerHTML = '<div style="font-size:12.5px;color:var(--text-muted);">Issue first.</div>'; return; }
    var named = live.filter(function (s) { return !!s.student_id; }).length;
    var html = '';
    if (mode === 'versions') {
      var vs = live[0].items.versions, per = Math.ceil(named / vs.length) + 2;
      html += '<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px;"><b>Step 1 \u2014 booklets.</b> Each button opens ONE master booklet. Print it once, then on the copier choose <b>' + per + ' copies, 2-sided, staple</b>. Repeat for each version.</div>' +
        '<div class="inline-actions" style="flex-wrap:wrap;gap:8px;margin-bottom:14px;">' +
        vs.map(function (v, i) { return '<button class="btn btn-primary btn-sm" data-swbook="' + i + '">Version ' + letter(i) + ' booklet</button>'; }).join('') + '</div>' +
        '<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px;"><b>Step 2 \u2014 answer sheets.</b> One loose page per student, name and QR code printed, sorted by last name. No stapling. Print 1-sided.</div>' +
        '<div class="inline-actions" style="flex-wrap:wrap;gap:8px;margin-bottom:14px;"><button class="btn btn-primary btn-sm" id="swSheets">Answer sheets (' + live.length + ' pages)</button>' +
        '<button class="btn btn-ghost btn-sm" id="swKey">Answer key (CSV)</button></div>' +
        '<div style="font-size:12px;color:var(--text-subtle);">In class: give each student their named sheet, and deal booklets A, B, C, D\u2026 along each row. Students fill the letter of their booklet in the \u201cBooklet version\u201d row.</div>';
    } else {
      html += '<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px;">Each student\u2019s booklet is followed by their answer sheet, in batches of 40. The copier can\u2019t staple these one student at a time: use <b>staple off</b>, keep the output stacked, and clip or staple by hand \u2014 or re-issue as booklet versions.</div>' +
        '<div class="inline-actions" style="flex-wrap:wrap;gap:8px;"><select id="swBatch" style="max-width:260px;"></select>' +
        '<label style="font-size:13px;display:flex;gap:6px;align-items:center;"><input type="checkbox" id="swSheetsOnly"> Answer sheets only</label>' +
        '<button class="btn btn-primary btn-sm" id="swPrint">Open print view</button><button class="btn btn-ghost btn-sm" id="swKey">Answer key (CSV)</button></div>';
    }
    box.innerHTML = html;
    if (mode === 'versions') {
      Array.prototype.forEach.call(box.querySelectorAll('[data-swbook]'), function (b) {
        b.addEventListener('click', function () { printVersionBooklet(Number(b.getAttribute('data-swbook'))); });
      });
      el('swSheets').addEventListener('click', function () { printSheets(printOrder()); });
    } else {
      var batches = chunk(printOrder(), 40);
      el('swBatch').innerHTML = batches.map(function (b, i) {
        return '<option value="' + i + '">Students ' + (i * 40 + 1) + '\u2013' + (i * 40 + b.length) + ' (' + h(b[0].student_label || '') + ' \u2026 ' + h(b[b.length - 1].student_label || '') + ')</option>';
      }).join('') + (batches.length > 1 ? '<option value="all">All ' + live.length + '</option>' : '');
      el('swPrint').addEventListener('click', function () {
        var v = el('swBatch').value, list = v === 'all' ? printOrder() : (batches[Number(v)] || []);
        if (el('swSheetsOnly').checked) { printSheets(list); } else { printPerStudent(list); }
      });
    }
    el('swKey').addEventListener('click', downloadKey);
  }

  function lastName(s) { var p = String(s || '').trim().split(/\s+/); return (p.length > 1 ? p[p.length - 1] + ' ' + p.slice(0, -1).join(' ') : p[0] || '').toLowerCase(); }
  function printOrder() {
    var named = [], spare = [];
    S.sheets.forEach(function (s) { if (s.status === 'void') { return; } (s.student_id ? named : spare).push(s); });
    named.sort(function (a, b) { var x = lastName(a.student_label), y = lastName(b.student_label); return x < y ? -1 : (x > y ? 1 : 0); });
    return named.concat(spare);
  }

  function fetchItems(ids) {
    var out = {};
    return runSeq(chunk(ids, 150), function (part) {
      return sb.from('im_assessment_item').select('*').in('id', part).then(function (r) {
        if (r.error) { throw new Error('Could not read the question bank: ' + r.error.message); }
        (r.data || []).forEach(function (it) { out[String(it.id)] = it; });
      });
    }).then(function () { return out; });
  }
  function fetchRecipePools(recipe) {
    return runSeq(recipe, function (r) {
      var q = sb.from('im_assessment_item').select('*').eq('is_active', true).eq('concept_tag', r.tag);
      if (r.pts) { q = q.eq('points', r.pts); }
      if (r.chapter) { q = q.eq('chapter', r.chapter); }
      return q.then(function (res) {
        if (res.error) { throw new Error('Could not read the question bank: ' + res.error.message); }
        return { n: Number(r.n) || 1, pool: res.data || [] };
      });
    });
  }

  var kindCache = {};
  function rowKind(row) {
    var k = String(row.id);
    if (!(k in kindCache)) { kindCache[k] = kindOf(genFor(row, 12345), row); }
    return kindCache[k];
  }
  function entryFor(row, seed) {
    var gen = genFor(row, seed), kind = kindOf(gen, row);
    if (kind === 'short') { return null; }
    var nopts = 0, perm = null;
    if (kind === 'mc') { nopts = ((gen && gen.options) || row.options || []).length || 4; perm = makePerm(nopts, seed); }
    if (kind === 'yn') { nopts = 2; }
    return { item_id: row.id, generator_id: row.generator_id || null, seed: seed, kind: kind, nopts: nopts, perm: perm,
      points: Number(row.points) || (gen && gen.points) || 1 };
  }
  // Shuffle entries but keep the kind at every position (so all versions share one answer-sheet layout).
  function shuffleWithinKind(entries) {
    var byKind = {};
    entries.forEach(function (e) { (byKind[e.kind] = byKind[e.kind] || []).push(e); });
    for (var k in byKind) { if (Object.prototype.hasOwnProperty.call(byKind, k)) { shuffle(byKind[k]); } }
    var used = {};
    return entries.map(function (e) { used[e.kind] = (used[e.kind] || 0); return byKind[e.kind][used[e.kind]++]; });
  }
  // MC first, then yes/no, then numeric: the booklet then reads in the same order as the answer sheet.
  function sectionOrder(entries) {
    var rank = { mc: 0, yn: 1, num: 2 };
    return entries.map(function (e, i) { return { e: e, i: i }; })
      .sort(function (a, b) { return (rank[a.e.kind] - rank[b.e.kind]) || (a.i - b.i); })
      .map(function (x) { return x.e; });
  }
  function number(list) { list.forEach(function (x, i) { x.q = i + 1; }); return list; }

  // Build one question set from source rows.
  function buildSet(rows, shuffleQ) {
    var entries = [], skipped = 0;
    rows.forEach(function (row) { var e = entryFor(row, randSeed()); if (e) { entries.push(e); } else { skipped++; } });
    entries = sectionOrder(entries);
    if (shuffleQ) { entries = shuffleWithinKind(entries); }
    return { items: number(entries), skipped: skipped };
  }
  // K versions that share one kind pattern.
  function buildVersions(P, K, shuffleQ) {
    var base, skipped = 0, versions = [];
    if (P.rows) {
      for (var v = 0; v < K; v++) { var b = buildSet(P.rows, shuffleQ); skipped = b.skipped; versions.push(b.items); }
      return { versions: versions, skipped: skipped };
    }
    // recipe: version A draws; later versions draw same-kind items from the same topic slot
    var slots = [];
    P.pools.forEach(function (sl, si) {
      var pool = shuffle(sl.pool.slice()).filter(function (r) { return rowKind(r) !== 'short'; });
      for (var k = 0; k < Math.min(sl.n, pool.length); k++) { slots.push({ si: si, row: pool[k] }); }
      skipped += Math.max(0, Math.min(sl.n, sl.pool.length) - Math.min(sl.n, pool.length));
    });
    for (v = 0; v < K; v++) {
      var usedIds = {}, rows = [];
      slots.forEach(function (s) {
        var row = s.row;
        if (v > 0) {
          var want = rowKind(s.row), cands = shuffle(P.pools[s.si].pool.filter(function (r) { return rowKind(r) === want && !usedIds[String(r.id)]; }));
          if (cands.length) { row = cands[0]; }
        }
        usedIds[String(row.id)] = true; rows.push(row);
      });
      var entries = [];
      rows.forEach(function (row) { var e = entryFor(row, randSeed()); if (e) { entries.push(e); } });
      entries = sectionOrder(entries);
      if (shuffleQ) { entries = shuffleWithinKind(entries); }
      versions.push(number(entries));
    }
    return { versions: versions, skipped: skipped };
  }

  function issueSheets() {
    var src = null, srcId = el('swSrc').value;
    S.sources.forEach(function (e) { if (String(e.id) === String(srcId)) { src = e; } });
    if (!src) { say('swIssueMsg', 'Pick a question source.', 'err'); return; }
    var mode = el('swMode').value, K = Number(el('swNV').value) || 4, shuffleQ = el('swShuffleQ').checked;
    var spares = Math.max(0, Math.min(60, parseInt(el('swSpares').value, 10) || 0));
    var gradedFor = {};
    S.sheets.forEach(function (s) { if (s.status === 'graded' && s.student_id) { gradedFor[s.student_id] = true; } });
    var targets = S.roster.filter(function (st) { return !gradedFor[st.id]; });
    var toVoid = S.sheets.filter(function (s) { return s.status !== 'graded' && s.status !== 'void'; });
    if (toVoid.length && !confirm('This replaces ' + toVoid.length + ' ungraded sheet(s). Anything already printed will stop scanning. Continue?')) { return; }
    el('swIssue').disabled = true;
    say('swIssueMsg', 'Building\u2026');

    var prep = src.random_per_student
      ? fetchRecipePools(src.random_recipe || []).then(function (pools) { return { pools: pools }; })
      : fetchItems((src.item_ids || []).map(String)).then(function (map) {
        var rows = (src.item_ids || []).map(function (id) { return map[String(id)]; }).filter(Boolean);
        if (!rows.length) { throw new Error('That exam\u2019s questions could not be read.'); }
        return { rows: rows };
      });
    prep.then(function (P) {
      var people = targets.map(function (st) { return { id: st.id, label: st.name }; });
      for (var i = 1; i <= spares; i++) { people.push({ id: null, label: 'Spare ' + i }); }
      var rows = [], skipped = 0, pts = null, ptsVary = false;
      function track(list) {
        var p = list.reduce(function (a, x) { return a + x.points; }, 0);
        if (pts === null) { pts = p; } else if (p !== pts) { ptsVary = true; pts = Math.max(pts, p); }
      }
      if (mode === 'versions') {
        var V = buildVersions(P, K, shuffleQ); skipped = V.skipped;
        if (!V.versions[0].length) { throw new Error('None of the questions can go on a bubble sheet (all written).'); }
        V.versions.forEach(track);
        var labels = V.versions.map(function (x, j) { return letter(j); });
        var payload = { mode: 'versions', labels: labels, versions: V.versions };
        var L = SheetwiseCore.layout(V.versions[0].map(function (it) { return { n: it.q, kind: it.kind, nopts: it.nopts }; }), { versions: K });
        people.forEach(function (p) {
          rows.push({ code: newCode(), exam_id: S.examId, course_id: S.courseId, student_id: p.id, student_label: p.label,
            items: payload, page_count: L.pageCount, layout_version: SheetwiseCore.VERSION, status: 'printed' });
        });
      } else {
        people.forEach(function (p) {
          var rowsFor = P.rows;
          if (!rowsFor) { rowsFor = []; P.pools.forEach(function (sl) { var pool = shuffle(sl.pool.slice()); for (var k = 0; k < Math.min(sl.n, pool.length); k++) { rowsFor.push(pool[k]); } }); }
          var b = buildSet(rowsFor, shuffleQ); skipped = Math.max(skipped, b.skipped); track(b.items);
          var L2 = SheetwiseCore.layout(b.items.map(function (it) { return { n: it.q, kind: it.kind, nopts: it.nopts }; }));
          rows.push({ code: newCode(), exam_id: S.examId, course_id: S.courseId, student_id: p.id, student_label: p.label,
            items: b.items, page_count: L2.pageCount, layout_version: SheetwiseCore.VERSION, status: 'printed' });
        });
        if (rows.length && !rows[0].items.length) { throw new Error('None of the questions can go on a bubble sheet (all written).'); }
      }
      if (!rows.length) { throw new Error('Everyone already has a graded sheet.'); }
      var voidIds = toVoid.map(function (s) { return s.id; });
      return runSeq(chunk(voidIds, 100), function (part) {
        return sb.from('im_paper_sheet').update({ status: 'void' }).in('id', part).then(function (r) { if (r.error) { throw new Error(r.error.message); } });
      }).then(function () {
        return runSeq(chunk(rows, mode === 'versions' ? 20 : 50), function (part) {
          return sb.from('im_paper_sheet').insert(part).then(function (r) { if (r.error) { throw new Error(r.error.message); } });
        });
      }).then(function () {
        var patch = (pts && Number(S.exam && S.exam.total_points) !== pts) ? { total_points: pts } : null;
        return (patch ? sb.from('im_exam').update(patch).eq('id', S.examId) : Promise.resolve({})).then(function () {
          return { n: rows.length, skipped: skipped, pts: pts, ptsVary: ptsVary, patched: !!patch, mode: mode, K: K };
        });
      });
    }).then(function (res) {
      return loadBase().then(function () {
        renderSetup();
        say('swIssueMsg', 'Issued ' + res.n + ' answer sheets' + (res.mode === 'versions' ? ' and ' + res.K + ' booklet versions' : '') + ' \u00b7 ' + res.pts + ' points' + (res.patched ? ' (exam total updated)' : '') + '.' +
          (res.skipped ? ' ' + res.skipped + ' written question(s) were left off.' : '') +
          (res.ptsVary ? ' Warning: point totals differ between versions/students \u2014 check the recipe.' : ''), res.ptsVary ? 'err' : 'ok');
      });
    }).catch(function (err) {
      el('swIssue').disabled = false;
      say('swIssueMsg', err && err.message ? err.message : String(err), 'err');
    });
  }

  /* ---------------------------------------------------------- printing */
  var PRINT_CSS = '@page{size:letter;margin:0.45in}' +
    'body.sw-print{background:#fff!important;color:#000!important;font-family:Georgia,"Times New Roman",serif;margin:0}' +
    '.sw-noprint{font-family:Helvetica,Arial,sans-serif;padding:10px 14px;background:#fffbe6;border-bottom:1px solid #ccc;font-size:14px}' +
    '@media print{.sw-noprint{display:none}}' +
    '.sw-sheet{page-break-before:always;break-before:page}.sw-sheet:first-of-type{page-break-before:auto;break-before:auto}' +
    '.sw-sheet svg{width:7.6in!important;height:auto!important;display:block;margin:0 auto}' +
    '.sw-book{page-break-before:always;break-before:page;font-size:11pt;line-height:1.38;color:#000}' +
    '.sw-book h1{font-size:15pt;margin:0 0 2px;color:#000}.sw-book .sub{font-size:9.5pt;color:#333;margin-bottom:10px;font-family:Helvetica,Arial,sans-serif}' +
    '.sw-cover{display:flex;gap:18px;align-items:center;border:2px solid #000;padding:10px 14px;margin-bottom:14px}' +
    '.sw-cover .big{font:800 44pt Helvetica,Arial,sans-serif;border:3px solid #000;width:1.1in;height:1.1in;display:flex;align-items:center;justify-content:center}' +
    '.sw-run{position:fixed;bottom:0;right:0;font:700 9pt Helvetica,Arial,sans-serif;color:#000}' +
    '@media screen{.sw-run{display:none}}' +
    '.sw-q{break-inside:avoid;page-break-inside:avoid;margin:0 0 13px}.sw-q .n{font-weight:700}' +
    '.sw-q ol{list-style:none;margin:4px 0 0 18px;padding:0}.sw-q li{margin:2px 0}' +
    '.sw-q .hint{font-family:Helvetica,Arial,sans-serif;font-size:9pt;color:#444}' +
    '.sw-sec{font:700 10pt Helvetica,Arial,sans-serif;border-bottom:1px solid #000;margin:14px 0 8px;padding-bottom:2px}' +
    '.sw-book .fig-svg{max-width:3.3in!important;margin:6px 0 6px 18px!important}.sw-book .fig-svg svg{width:100%!important;height:auto!important;max-height:2.6in}.sw-book *{color:#000}' +
    '.sw-book .pm-table td,.sw-book .pm-table th{border:1px solid #444!important;background:#fff!important;padding:3px 8px}';

  function openPrintWindow(title, note, build) {
    var w = window.open('', '_blank');
    if (!w) { say('swPrintMsg', 'The print window was blocked. Allow pop-ups for this site and try again.', 'err'); return; }
    say('swPrintMsg', 'Building the print view\u2026');
    try { w.document.write('<p style="font-family:sans-serif;padding:20px">Building\u2026</p>'); } catch (e) {}
    Promise.resolve().then(build).then(function (body) {
      var css = '';
      Array.prototype.forEach.call(document.querySelectorAll('style'), function (st) { css += st.textContent + '\n'; });
      var html = '<!doctype html><html><head><meta charset="utf-8"><title>' + h(title) + '</title><style>' + css + '</style><style>' + PRINT_CSS + '</style></head>' +
        '<body class="sw-print"><div class="sw-noprint">' + note + ' <button onclick="window.print()">Print</button></div>' + body + '</body></html>';
      w.document.open(); w.document.write(html); w.document.close();
      say('swPrintMsg', 'Print view opened in a new tab.', 'ok');
    }).catch(function (err) { say('swPrintMsg', err.message || String(err), 'err'); try { w.close(); } catch (e2) {} });
  }

  function sheetPagesHTML(sheet) {
    var L = layoutFor(sheet), out = [];
    for (var p = 0; p < L.pages.length; p++) {
      out.push('<div class="sw-sheet">' + SheetwiseCore.renderPageSVG(L.pages[p], {
        title: S.title, studentName: sheet.student_id ? sheet.student_label : '',
        studentLine2: sheet.student_id ? '' : (sheet.student_label || 'Spare') + ' \u2014 write your name',
        code: sheet.code, pageCount: L.pageCount }) + '</div>');
    }
    // 2-page sheets: pad to an even count so 2-sided printing keeps each student on one piece of paper
    if (L.pages.length > 1 && L.pages.length % 2 === 1) { out.push('<div class="sw-sheet"><p style="font:10pt Helvetica,Arial,sans-serif;color:#777;text-align:center;margin-top:4in">(intentionally blank)</p></div>'); }
    return out.join('');
  }
  function needIds(sets) { var o = {}; sets.forEach(function (list) { list.forEach(function (it) { o[String(it.item_id)] = true; }); }); return Object.keys(o); }

  function printSheets(list) {
    if (!list.length) { return; }
    var multi = list.some(function (s) { return (s.page_count || 1) > 1; });
    openPrintWindow(S.title + ' \u2014 answer sheets', '<b>' + list.length + ' answer sheets</b>, sorted by last name, spares last. ' +
      (multi ? 'Each sheet has 2 pages: print <b>2-sided</b> (one piece of paper per student) and scan 2-sided.' : 'One page each: print 1-sided, no stapling.'), function () {
      return list.map(sheetPagesHTML).join('');
    });
  }
  function printVersionBooklet(v) {
    var live = printOrder(); if (!live.length) { return; }
    var set = live[0].items.versions[v], lab = letter(v);
    var named = live.filter(function (s) { return !!s.student_id; }).length, K = live[0].items.versions.length;
    openPrintWindow(S.title + ' \u2014 Version ' + lab, '<b>Master booklet, Version ' + lab + '.</b> Print ONE copy, then on the copier: <b>' + (Math.ceil(named / K) + 2) + ' copies, 2-sided, staple top-left</b>.', function () {
      return fetchItems(needIds([set])).then(function (map) {
        return '<div class="sw-run">' + h(S.title) + ' \u00b7 VERSION ' + lab + '</div>' + bookletHTML(set, map, { version: lab });
      });
    });
  }
  function printPerStudent(list) {
    if (!list.length) { return; }
    openPrintWindow(S.title + ' \u2014 print', '<b>' + list.length + ' students</b> \u00b7 each booklet followed by that student\u2019s answer sheet. Staple OFF.', function () {
      return fetchItems(needIds(list.map(function (s) { return versionSets(s)[0]; }))).then(function (map) {
        return list.map(function (s) {
          return bookletHTML(versionSets(s)[0], map, { student: s.student_id ? s.student_label : 'Spare booklet \u2014 write your name on the answer sheet', code: s.code }) + sheetPagesHTML(s);
        }).join('');
      });
    });
  }

  function bookletHTML(items, itemMap, o) {
    var b = ['<div class="sw-book">'];
    if (o.version) {
      b.push('<div class="sw-cover"><div class="big">' + o.version + '</div><div><h1>' + h(S.title) + '</h1>' +
        '<div class="sub" style="margin:4px 0 0;font-size:11pt;">Question booklet \u00b7 <b>Version ' + o.version + '</b> \u00b7 ' + items.length + ' questions.<br>' +
        'On your answer sheet, fill bubble <b>' + o.version + '</b> in the <b>Booklet version</b> row first. Mark every answer on the answer sheet; only the sheet is graded.</div></div></div>');
    } else {
      b.push('<h1>' + h(S.title) + '</h1><div class="sub">' + h(o.student || '') + ' \u00b7 booklet ' + h(o.code || '') + ' \u00b7 ' + items.length + ' questions. Mark every answer on your answer sheet; only the sheet is graded.</div>');
    }
    var lastKind = null;
    items.forEach(function (it) {
      if (it.kind !== lastKind) {
        b.push('<div class="sw-sec">' + (it.kind === 'num' ? 'Numeric answers \u2014 write the number in the boxes on your sheet, then bubble each digit' : (it.kind === 'yn' ? 'Yes / No' : 'Multiple choice')) + '</div>');
        lastKind = it.kind;
      }
      var row = itemMap[String(it.item_id)] || {};
      var gen = genFor(row, it.seed);
      var prompt = gen && gen.prompt ? gen.prompt : (row.prompt || '');
      var fig = figureFor(gen);
      b.push('<div class="sw-q"><span class="n">' + it.q + '.</span> ' + h(prompt));
      if (fig && typeof renderFigure === 'function') { b.push(renderFigure(fig)); }
      if (it.kind === 'mc') {
        var opts = (gen && gen.options) ? gen.options : (row.options || []);
        var perm = it.perm || null;
        b.push('<ol>');
        for (var i = 0; i < opts.length; i++) { b.push('<li><b>' + letter(i) + '.</b> ' + h(stripLetter(opts[perm ? perm[i] : i])) + '</li>'); }
        b.push('</ol>');
      } else if (it.kind === 'yn') {
        b.push('<div class="hint">Answer on the sheet: Y = yes, N = no.</div>');
      } else {
        b.push('<div class="hint">Use \u2212 for negatives and . for decimals; round to 2 decimals.</div>');
      }
      b.push('</div>');
    });
    b.push('</div>');
    return b.join('');
  }

  /* ------------------------------------------------------- answer key */
  function correctOriginal(it) {
    if (it.kind === 'mc') {
      if (it.generator_id) { var g = genFor({ generator_id: it.generator_id }, it.seed); return g ? g.answer : null; }
      return staticAnswerIndex(it);
    }
    return null;
  }
  function staticAnswerIndex(it) {
    var k = S.keys[String(it.item_id)]; if (!k) { return null; }
    var a = k.answer; if (a && typeof a === 'object' && !Array.isArray(a)) { a = a.value != null ? a.value : (a.index != null ? a.index : a.answer); }
    a = String(a).trim();
    if (/^\d+$/.test(a)) { return Number(a); }
    if (/^[A-Za-z]$/.test(a)) { return a.toUpperCase().charCodeAt(0) - 65; }
    return null;
  }
  function correctDisplay(it) {
    if (it.kind === 'mc') {
      var o = correctOriginal(it); if (o == null) { return '?'; }
      var d = it.perm ? it.perm.indexOf(o) : o; return d >= 0 ? letter(d) : '?';
    }
    if (it.kind === 'yn') { try { return IMGenerators.grade(it.generator_id, it.seed, 'yes').correct ? 'Y' : 'N'; } catch (e) { return '?'; } }
    var g = genFor({ generator_id: it.generator_id }, it.seed);
    if (g && g.answer != null) { return String(Math.round(Number(g.answer) * 100) / 100); }
    var k = S.keys[String(it.item_id)]; return k ? String(k.answer) : '?';
  }
  function downloadKey() {
    var live = printOrder(); if (!live.length) { return; }
    var lines = [];
    if (isVersioned(live[0])) {
      var vs = live[0].items.versions;
      loadStaticKeys(needIds(vs)).then(function () {
        lines.push('version,question,correct,points,item_id');
        vs.forEach(function (set, v) { set.forEach(function (it) { lines.push([letter(v), it.q, csv(correctDisplay(it)), it.points, it.item_id].join(',')); }); });
        saveText(lines.join('\n'), fileBase() + '_answer_key.csv');
      });
    } else {
      loadStaticKeys(needIds(live.map(function (s) { return s.items; }))).then(function () {
        lines.push('code,student,question,correct,points,item_id');
        live.forEach(function (s) { s.items.forEach(function (it) { lines.push([s.code, csv(s.student_label), it.q, csv(correctDisplay(it)), it.points, it.item_id].join(',')); }); });
        saveText(lines.join('\n'), fileBase() + '_answer_key.csv');
      });
    }
  }
  function fileBase() { return (S.title || 'exam').replace(/[^a-z0-9]+/gi, '_'); }
  function csv(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function saveText(text, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.parentNode.removeChild(a); }, 500);
  }

  /* ========================================================== TAB 2: scan */
  function sheetByCode(code) {
    for (var i = 0; i < S.sheets.length; i++) { if (S.sheets[i].code === code && S.sheets[i].status !== 'void') { return S.sheets[i]; } }
    return null;
  }
  function resolvePage(code, pageNo) {
    var s = sheetByCode(code); if (!s) { return null; }
    return layoutFor(s).pages[(pageNo || 1) - 1] || null;
  }

  function renderScan() {
    if (!S.scan) { S.scan = { pages: [], busy: false, log: [] }; }
    var html = '<div class="card" style="margin-bottom:14px;">' +
      '<div style="font-weight:700;margin-bottom:6px;">Add scans</div>' +
      '<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px;">Scan the answer sheets to PDF on the copier (black &amp; white or grey, 200\u2013300 dpi) and add the file here. Whole stacks are fine, in any order, either way up; stray booklet pages are skipped. Reading happens in this browser.</div>' +
      '<input type="file" id="swFile" accept=".pdf,application/pdf,image/jpeg,image/png,image/*" multiple style="display:none">' +
      '<div id="swDrop" style="border:2px dashed var(--border-strong,#888);border-radius:12px;padding:22px;text-align:center;">' +
      '<button class="btn btn-primary btn-sm" id="swPick" type="button">Choose scan files</button>' +
      '<div style="font-size:12.5px;margin-top:8px;color:var(--text-muted);">or drag PDFs / JPEGs / PNGs onto this box</div></div>' +
      '<div id="swProg" style="margin-top:10px;font-size:13px;"></div>' +
      '<div id="swLog" style="margin-top:8px;max-height:150px;overflow:auto;font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--text-muted);"></div></div>' +
      '<div id="swScanSummary"></div><div id="swReview"></div>';
    if (!S.sheets.length) {
      html = '<div class="card" style="margin-bottom:14px;border-left:4px solid var(--danger,#e11d48);"><b>No answer sheets have been issued for this exam yet.</b>' +
        '<div style="font-size:12.5px;color:var(--text-muted);margin-top:4px;">Scans can only be graded under the exam their sheets were issued for. You can still add a scan here \u2014 Sheetwise will tell you which exam and course it belongs to.</div></div>' + html;
    }
    el('swBody').innerHTML = html;
    var drop = el('swDrop'), inp = el('swFile');
    el('swPick').addEventListener('click', function () { inp.click(); });
    inp.addEventListener('change', function () { var f = Array.prototype.slice.call(inp.files || []); inp.value = ''; if (f.length) { ingest(f); } });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.style.background = 'rgba(124,109,242,.12)'; });
    drop.addEventListener('dragleave', function () { drop.style.background = ''; });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.style.background = '';
      var f = e.dataTransfer ? Array.prototype.slice.call(e.dataTransfer.files || []) : [];
      if (f.length) { ingest(f); } else { logLine('Nothing was dropped \u2014 drag the file itself (from Finder), or use \u201cChoose scan files\u201d.', true); }
    });
    renderLog();
    renderScanState();
  }
  function logLine(t, bad) { if (!S || !S.scan) { return; } S.scan.log.push({ t: t, bad: !!bad }); renderLog(); }
  function renderLog() {
    var box = el('swLog'); if (!box || !S.scan) { return; }
    box.innerHTML = S.scan.log.slice(-200).map(function (l) { return '<div' + (l.bad ? ' style="color:var(--danger,#e11d48)"' : '') + '>' + h(l.t) + '</div>'; }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function ingest(files) {
    if (S.scan.busy) { logLine('Still reading the previous files \u2014 wait for them to finish.', true); return; }

    S.scan.busy = true;
    el('swProg').innerHTML = '<span class="spinner"></span> Loading the scan reader\u2026';
    ensureScanLibs().then(function () {
      return runSeq(files, function (file) {
        var name = file.name || 'file';
        if (/\.(heic|heif)$/i.test(name) || /hei[cf]/i.test(file.type || '')) { logLine(name + ': iPhone HEIC photos can\u2019t be read in the browser. Scan to PDF, or export as JPEG.', true); return; }
        if (/\.(tif|tiff)$/i.test(name) || /tiff/i.test(file.type || '')) { logLine(name + ': TIFF isn\u2019t supported. Set the copier to scan to PDF.', true); return; }
        logLine(name + ' (' + Math.round((file.size || 0) / 1024) + ' KB): opening\u2026');
        var nPages = 0;
        return SheetwiseCore.loadFiles([file], function (cv, n, total, label) {
          nPages++;
          el('swProg').innerHTML = '<span class="spinner"></span> ' + h(name) + ': reading page ' + n + (total ? ' of ' + total : '') + '\u2026';
          return new Promise(function (res) {
            setTimeout(function () {
              var out;
              try { out = SheetwiseCore.readCanvas(cv, resolvePage); } catch (e) { out = { ok: false, error: 'Read error: ' + e.message }; }
              out.source = label || name;
              if (!out.ok) { out.thumb = thumb(cv); }
              S.scan.pages.push(out);
              logLine('  ' + out.source + ': ' + describeRead(out), !out.ok && (out.found || 0) >= 2);
              cv.width = cv.height = 0;
              res();
            }, 0);
          });
        }).then(function () { if (!nPages) { logLine(name + ': no pages found in this file.', true); } },
          function (err) { logLine(name + ': could not open \u2014 ' + (err && err.message ? err.message : String(err)), true); });
      });
    }).then(function () {
      return lookupForeign();
    }).then(function () {
      S.scan.busy = false;
      el('swProg').textContent = 'Done. ' + S.scan.pages.length + ' page(s) read so far.';
      renderScanState();
    }).catch(function (err) {
      S.scan.busy = false;
      el('swProg').innerHTML = '<span style="color:var(--danger,#e11d48)">' + h(err.message || String(err)) + '</span>';
      renderScanState();
    });
  }
  // Pages whose QR code isn't a live sheet of THIS exam: find out where they belong.
  function lookupForeign() {
    S.scan.foreign = S.scan.foreign || {};
    var codes = {};
    S.scan.pages.forEach(function (p) { if (p.ok && p.code && !p.read && !(p.code in S.scan.foreign)) { codes[p.code] = true; } });
    var list = Object.keys(codes); if (!list.length) { return Promise.resolve(); }
    return sb.from('im_paper_sheet').select('code,exam_id,course_id,status,student_label').in('code', list).then(function (r) {
      var rows = r.data || [], exIds = {}, cIds = {};
      list.forEach(function (c) { S.scan.foreign[c] = { missing: true }; });
      rows.forEach(function (x) { S.scan.foreign[x.code] = x; exIds[x.exam_id] = true; cIds[x.course_id] = true; });
      if (!rows.length) { return null; }
      return Promise.all([
        sb.from('im_exam').select('id,title').in('id', Object.keys(exIds)),
        sb.from('im_course').select('id,title').in('id', Object.keys(cIds))
      ]).then(function (rr) {
        var et = {}, ct = {};
        ((rr[0] && rr[0].data) || []).forEach(function (e) { et[e.id] = e.title; });
        ((rr[1] && rr[1].data) || []).forEach(function (c) { ct[c.id] = c.title; });
        rows.forEach(function (x) { x.examTitle = et[x.exam_id] || 'another exam'; x.courseTitle = ct[x.course_id] || 'another course'; });
      });
    }).then(function () {
      S.scan.pages.forEach(function (p) {
        var f = p.ok && p.code && !p.read ? S.scan.foreign[p.code] : null; if (!f) { return; }
        if (f.missing) { p.warning = 'Sheet ' + p.code + ' doesn\u2019t exist (it may belong to another site or was deleted).'; }
        else if (String(f.exam_id) === String(S.examId) && f.status === 'void') { p.warning = 'Sheet ' + p.code + ' (' + (f.student_label || '') + ') was replaced when sheets were re-issued. Grade it by typing the student\u2019s current sheet code, or re-scan their new sheet.'; }
        else { p.warning = 'This page belongs to \u201c' + f.examTitle + '\u201d in ' + f.courseTitle + (f.student_label ? ' (' + f.student_label + ')' : '') + '. Open that exam\u2019s Bubble sheets to grade it.'; p.foreign = true; }
        logLine('  ' + (p.source || '') + ': ' + p.warning, true);
      });
    }, function () { /* lookup is best-effort */ });
  }

  function describeRead(o) {
    if (!o.ok) { return o.error || 'not an answer sheet'; }
    var s = o.code ? sheetByCode(o.code) : null;
    if (!o.read) { return o.warning || 'needs its code'; }
    var n = 0; for (var q in o.groups) { if (o.groups[q].needsReview) { n++; } }
    return (s ? s.student_label : o.code) + (o.rotation ? ' (upside down)' : '') + ' \u2713' + (n ? ' \u00b7 ' + n + ' to check' : '');
  }
  function thumb(cv) {
    var t = document.createElement('canvas'), s = 260 / cv.width; t.width = 260; t.height = Math.round(cv.height * s);
    t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height); return t.toDataURL('image/jpeg', 0.6);
  }

  function collate() {
    var bySheet = {}, orphans = [], skipped = [];
    S.scan.pages.forEach(function (p, idx) {
      p._idx = idx;
      if (!p.ok) { skipped.push(p); return; }
      if (!p.read) { orphans.push(p); return; }
      var s = sheetByCode(p.code);
      var e = bySheet[p.code] || (bySheet[p.code] = { sheet: s, pages: {}, answers: {} });
      e.pages[p.page] = p;
      for (var q in p.groups) { if (Object.prototype.hasOwnProperty.call(p.groups, q)) { e.answers[q] = p.groups[q]; } }
    });
    var list = Object.keys(bySheet).map(function (k) { return bySheet[k]; });
    var assign = S.scan.assign || {};
    list.forEach(function (e) {
      if (assign[e.sheet.code]) { e.assignTo = assign[e.sheet.code]; }
      e.missingPages = [];
      for (var i = 1; i <= (e.sheet.page_count || 1); i++) { if (!e.pages[i]) { e.missingPages.push(i); } }
      e.review = [];
      var va = e.answers.V;
      if (isVersioned(e.sheet)) {
        if (va && va.needsReview && !va.resolved) { e.review.push(va); }
        e.version = (va && va.value != null && va.value !== '') ? Number(va.value) : null;
      }
      var items = itemsFor(e.sheet, e.version) || versionSets(e.sheet)[0];
      items.forEach(function (it) { var a = e.answers[it.q]; if (a && a.needsReview && !a.resolved) { e.review.push(a); } });
    });
    return { sheets: list, orphans: orphans, skipped: skipped };
  }

  function renderScanState() {
    var C = collate(); S.scan.collated = C;
    var nReview = 0, nMissing = 0, nSpareUnassigned = 0;
    C.sheets.forEach(function (e) { nReview += e.review.length; if (e.missingPages.length) { nMissing++; } if (!e.sheet.student_id && !e.assignTo) { nSpareUnassigned++; } });
    var sum = el('swScanSummary'); if (!sum) { return; }
    if (!S.scan.pages.length) { sum.innerHTML = ''; el('swReview').innerHTML = ''; return; }
    var bad = C.skipped.filter(function (p) { return (p.found || 0) >= 2 || (p.error && /orientation|contrast|Read error/i.test(p.error)); });
    var blockers = nReview + nMissing + nSpareUnassigned + C.orphans.length;
    sum.innerHTML = '<div class="card" style="margin-bottom:14px;display:flex;gap:18px;flex-wrap:wrap;align-items:center;">' +
      stat(C.sheets.length, 'answer sheets read') + stat(nReview, 'marks to check', nReview) + stat(C.orphans.length, 'pages need a code', C.orphans.length) +
      stat(bad.length, 'unreadable sheets', bad.length) + stat(nSpareUnassigned, 'spares to assign', nSpareUnassigned) + stat(C.skipped.length - bad.length, 'other pages skipped') +
      '<div style="flex:1"></div><button class="btn btn-primary" id="swGrade"' + (C.sheets.length ? '' : ' disabled') + '>Grade &amp; save ' + C.sheets.length + ' sheet' + (C.sheets.length === 1 ? '' : 's') + '</button>' +
      '<div class="msg" id="swGradeMsg" style="display:none;width:100%;"></div></div>';
    el('swGrade').addEventListener('click', function () {
      if (blockers && !confirm('There are still ' + blockers + ' item(s) to resolve. Unresolved marks count as blank; sheets with no booklet version or no student are skipped. Continue?')) { return; }
      gradeAndSave(C);
    });
    var rv = [];
    bad.forEach(function (p) {
      rv.push('<div class="card" style="margin-bottom:10px;display:flex;gap:14px;align-items:flex-start;border-left:4px solid var(--danger,#e11d48);"><img src="' + p.thumb + '" style="width:150px;border:1px solid var(--border);background:#fff">' +
        '<div><div style="font-weight:700;margin-bottom:4px;">Looks like an answer sheet but couldn\u2019t be read</div><div style="font-size:12.5px;color:var(--text-muted);">' + h(p.error || '') + ' (' + h(p.source || '') + '). Re-scan it (whole page, not cropped) and add the file again.</div></div></div>');
    });
    C.orphans.forEach(function (p) {
      if (p.foreign) {
        rv.push('<div class="card" style="margin-bottom:10px;display:flex;gap:14px;align-items:flex-start;border-left:4px solid var(--warn,#d97706);"><img src="' + p.preview + '" style="width:150px;border:1px solid var(--border);border-radius:6px;background:#fff">' +
          '<div><div style="font-weight:700;margin-bottom:4px;">Wrong exam</div><div style="font-size:13px;">' + h(p.warning) + '</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px;">' + h(p.source || '') + '</div></div></div>');
        return;
      }
      rv.push('<div class="card" style="margin-bottom:10px;display:flex;gap:14px;align-items:flex-start;"><img src="' + p.preview + '" style="width:190px;border:1px solid var(--border);border-radius:6px;background:#fff">' +
        '<div style="flex:1"><div style="font-weight:700;margin-bottom:4px;">Page needs its sheet code</div><div style="font-size:12.5px;color:var(--text-muted);margin-bottom:8px;">' + h(p.warning || '') + ' (' + h(p.source || '') + ')</div>' +
        '<input type="text" data-orphan="' + p._idx + '" placeholder="7-letter code under the QR" style="width:170px;text-transform:uppercase"> ' +
        '<select data-orphanpg="' + p._idx + '" style="width:90px"><option value="1">page 1</option><option value="2">page 2</option><option value="3">page 3</option></select> ' +
        '<button class="btn btn-ghost btn-sm" data-orphango="' + p._idx + '">Read</button> <button class="btn btn-ghost btn-sm" data-orphandrop="' + p._idx + '">Ignore page</button></div></div>');
    });
    C.sheets.forEach(function (e) {
      var s = e.sheet, head = '<b>' + h(s.student_label || '') + '</b> <span class="tag dim">' + h(s.code) + '</span>';
      if (!s.student_id) {
        rv.push('<div class="card" style="margin-bottom:10px;"><div style="margin-bottom:8px;">' + head + ' \u2014 spare sheet: who wrote it?</div>' +
          '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;"><img src="' + (e.pages[1] ? e.pages[1].preview : '') + '" style="width:300px;border:1px solid var(--border);border-radius:6px;background:#fff;object-fit:cover;object-position:top;height:120px">' +
          '<select data-assign="' + h(s.code) + '" style="min-width:240px;"><option value="">\u2014 choose student \u2014</option>' + S.roster.map(function (st) {
            return '<option value="' + h(st.id) + '"' + (e.assignTo === st.id ? ' selected' : '') + '>' + h(st.name) + (st.email ? ' \u00b7 ' + h(st.email) : '') + '</option>'; }).join('') + '</select></div></div>');
      }
      if (e.missingPages.length) {
        rv.push('<div class="card" style="margin-bottom:10px;">' + head + ' \u2014 <span style="color:var(--danger,#e11d48)">page ' + e.missingPages.join(', ') + ' not scanned yet.</span> Add it, or grade anyway (its questions count as blank).</div>');
      }
      e.review.forEach(function (a) { rv.push(reviewCard(e, a)); });
    });
    if (C.skipped.length - bad.length > 0) {
      rv.push('<details class="card" style="margin-bottom:10px;"><summary style="cursor:pointer;">' + (C.skipped.length - bad.length) + ' page(s) skipped as not answer sheets</summary><div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;">' +
        C.skipped.filter(function (p) { return bad.indexOf(p) < 0; }).map(function (p) { return '<div style="width:140px;font-size:11px;"><img src="' + p.thumb + '" style="width:140px;border:1px solid var(--border);background:#fff"><div>' + h(p.source || '') + '</div><div style="color:var(--text-subtle)">' + h(p.error || '') + '</div></div>'; }).join('') + '</div></details>');
    }
    el('swReview').innerHTML = rv.join('') || '<div class="card empty">Nothing needs checking \u2014 every mark was clear.</div>';
    wireReview();
  }
  function stat(n, label, warn) { return '<div><div style="font-size:22px;font-weight:800;' + (warn ? 'color:var(--warn,#d97706)' : '') + '">' + n + '</div><div style="font-size:11.5px;color:var(--text-muted)">' + label + '</div></div>'; }

  var STATUS_TXT = { outside: 'Mark outside the bubble', faint: 'Faint mark', multiple: 'More than one bubble filled', unclear: 'Possible erasure', gap: 'Gap between digits', invalid: 'Not a valid number', blank: 'Left blank' };
  function reviewCard(e, a) {
    var s = e.sheet, key = h(s.code) + ':' + a.q, ctl;
    if (a.kind === 'num') {
      ctl = '<input type="text" data-fixnum="' + key + '" value="' + h(a.value == null ? '' : a.value) + '" placeholder="number" style="width:120px"> ' +
        '<button class="btn btn-primary btn-sm" data-fixnumgo="' + key + '">Use this</button> <button class="btn btn-ghost btn-sm" data-fix="' + key + '" data-v="">Blank</button>';
    } else {
      ctl = a.labels.map(function (lb, i) {
        var v = a.kind === 'yn' ? (i === 0 ? 'yes' : 'no') : String(i);
        return '<button class="btn btn-sm ' + (String(a.value) === v ? 'btn-primary' : 'btn-ghost') + '" data-fix="' + key + '" data-v="' + v + '" data-d="' + lb + '">' + lb + '</button>';
      }).join(' ') + (a.kind === 'version' ? '' : ' <button class="btn btn-ghost btn-sm" data-fix="' + key + '" data-v="">Blank</button>');
    }
    var title = a.q === 'V' ? 'Booklet version \u2014 check the letter on their booklet' : 'Q' + a.q;
    return '<div class="card" style="margin-bottom:10px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;">' +
      '<img src="' + (a.crop || '') + '" style="max-height:' + (a.kind === 'num' ? 240 : 60) + 'px;max-width:420px;border:1px solid var(--border);border-radius:6px;background:#fff">' +
      '<div style="flex:1;min-width:220px;"><div style="margin-bottom:4px;"><b>' + h(s.student_label || '') + '</b> \u00b7 ' + title + ' <span class="tag amber">' + h(STATUS_TXT[a.status] || a.status) + '</span></div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Read as: <b>' + h(a.display || '(nothing)') + '</b></div>' + ctl + '</div></div>';
  }
  function findAnswer(key) {
    var i = key.lastIndexOf(':'), code = key.slice(0, i), q = key.slice(i + 1), C = S.scan.collated;
    for (var j = 0; j < C.sheets.length; j++) { if (C.sheets[j].sheet.code === code) { return C.sheets[j].answers[q]; } }
    return null;
  }
  function wireReview() {
    var box = el('swReview');
    Array.prototype.forEach.call(box.querySelectorAll('[data-fix]'), function (b) {
      b.addEventListener('click', function () {
        var a = findAnswer(b.getAttribute('data-fix')); if (!a) { return; }
        var v = b.getAttribute('data-v');
        a.value = v === '' ? null : v; a.display = v === '' ? '' : (b.getAttribute('data-d') || v);
        a.resolved = true; a.edited = true; renderScanState();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-fixnumgo]'), function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-fixnumgo'), a = findAnswer(key); if (!a) { return; }
        var inp = box.querySelector('[data-fixnum="' + key + '"]'), v = inp ? inp.value.replace(/\s+/g, '').replace(/\u2212/g, '-') : '';
        if (v !== '' && !/^-?(\d+\.?\d*|\.\d+)$/.test(v)) { inp.style.borderColor = '#e11d48'; return; }
        a.value = v === '' ? null : v; a.display = v; a.resolved = true; a.edited = true; renderScanState();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-assign]'), function (sel) {
      sel.addEventListener('change', function () {
        S.scan.assign = S.scan.assign || {}; S.scan.assign[sel.getAttribute('data-assign')] = sel.value || null;
        renderScanState();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-orphango]'), function (b) {
      b.addEventListener('click', function () {
        var idx = Number(b.getAttribute('data-orphango')), p = S.scan.pages[idx];
        var code = (box.querySelector('[data-orphan="' + idx + '"]').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        var pg = Number(box.querySelector('[data-orphanpg="' + idx + '"]').value) || 1;
        var layout = resolvePage(code, pg);
        if (!layout) { alert('No sheet with code ' + code + ' (page ' + pg + ') in this exam.'); return; }
        if (!p._img) { alert('This page\u2019s image is no longer in memory \u2014 please re-scan it.'); return; }
        p.code = code; p.page = pg; SheetwiseCore.finishRead(p, layout); renderScanState();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-orphandrop]'), function (b) {
      b.addEventListener('click', function () { var p = S.scan.pages[Number(b.getAttribute('data-orphandrop'))]; p.ok = false; p.error = 'Ignored by you'; p.thumb = p.preview; p._img = null; renderScanState(); });
    });
  }

  /* ------------------------------------------------------------ grading */
  function loadStaticKeys(itemIds) {
    var need = itemIds.filter(function (id) { return !(String(id) in S.keys); });
    if (!need.length) { return Promise.resolve(); }
    return runSeq(chunk(need, 150), function (part) {
      return sb.from('im_assessment_item_key').select('item_id,answer,tolerance').in('item_id', part).then(function (r) {
        part.forEach(function (id) { if (!(String(id) in S.keys)) { S.keys[String(id)] = null; } });
        (r.data || []).forEach(function (k) { S.keys[String(k.item_id)] = k; });
      });
    });
  }
  function gradeStatic(it, key, value, row) {
    if (!key || value == null) { return { correct: false, known: !!key }; }
    var ans = key.answer;
    if (ans && typeof ans === 'object' && !Array.isArray(ans)) { ans = ans.value != null ? ans.value : (ans.index != null ? ans.index : ans.answer); }
    if (it.kind === 'mc') {
      var idx = Number(value), a = String(ans).trim();
      if (/^\d+$/.test(a)) { return { correct: Number(a) === idx, known: true }; }
      if (/^[A-Za-z]$/.test(a)) { return { correct: a.toUpperCase().charCodeAt(0) - 65 === idx, known: true }; }
      var opt = (row && row.options) ? stripLetter(row.options[idx]) : '';
      return { correct: opt.trim().toLowerCase() === a.toLowerCase(), known: true };
    }
    if (it.kind === 'yn') { return { correct: String(ans).toLowerCase().charAt(0) === String(value).charAt(0), known: true }; }
    var tol = Number(key.tolerance) || 0.01, x = parseFloat(value), y = parseFloat(ans);
    if (isNaN(x) || isNaN(y)) { return { correct: false, known: true }; }
    return { correct: Math.abs(x - y) <= Math.max(tol, Math.abs(y) * 1e-9), known: true };
  }
  // answers: {q: {value, override}} as read from the sheet (displayed option index for MC)
  function gradeItems(items, answers, itemMap) {
    var score = 0, max = 0, per = [], unknownKey = 0;
    items.forEach(function (it) {
      var a = answers[it.q] || null, v = a ? a.value : null, ok = false;
      max += it.points;
      if (v != null && v !== '') {
        var sub = String(v);
        if (it.kind === 'mc' && it.perm) { var d = Number(v); sub = String(it.perm[d] != null ? it.perm[d] : d); }
        if (it.generator_id && typeof IMGenerators !== 'undefined') {
          try { var g = IMGenerators.grade(it.generator_id, Number(it.seed), sub); ok = !!(g && g.correct); } catch (e) { ok = false; }
        } else {
          var r = gradeStatic(it, S.keys[String(it.item_id)], sub, itemMap[String(it.item_id)]);
          ok = r.correct; if (!r.known) { unknownKey++; }
        }
      }
      var earned = ok ? it.points : 0;
      var ov = a && a.override != null && a.override !== '' ? Number(a.override) : null;
      if (ov !== null && !isNaN(ov)) { earned = Math.max(0, Math.min(it.points, ov)); }
      score += earned;
      per.push({ q: it.q, item_id: it.item_id, answer: v, correct: ok, earned: earned, points: it.points, override: ov });
    });
    return { score: Math.round(score * 100) / 100, max: max, per: per, unknownKey: unknownKey };
  }
  function versionFromAnswers(sheet, answers) {
    if (!isVersioned(sheet)) { return null; }
    var a = answers && answers.V; return (a && a.value != null && a.value !== '') ? Number(a.value) : null;
  }

  /* ---------------------------------------------------- scan storage */
  var BUCKET = 'paper-scans';
  function dataUrlToBlob(u) {
    var parts = u.split(','), bin = atob(parts[1]), n = bin.length, arr = new Uint8Array(n);
    for (var i = 0; i < n; i++) { arr[i] = bin.charCodeAt(i); }
    return new Blob([arr], { type: 'image/jpeg' });
  }
  function scanPath(sheet, pageNo) { return String(S.courseId) + '/' + String(S.examId) + '/' + String(sheet.id) + '/p' + pageNo + '.jpg'; }
  function uploadScans(e) {
    var paths = [], fails = 0;
    var nums = Object.keys(e.pages).map(Number).sort(function (a, b) { return a - b; });
    return runSeq(nums, function (n) {
      var p = e.pages[n]; if (!p || !p.archive) { return null; }
      var path = scanPath(e.sheet, n);
      return sb.storage.from(BUCKET).upload(path, dataUrlToBlob(p.archive), { upsert: true, contentType: 'image/jpeg' }).then(function (r) {
        if (r && r.error) { fails++; S.lastUploadError = r.error.message; } else { paths.push(path); }
      }, function (err) { fails++; S.lastUploadError = err && err.message; });
    }).then(function () { return { paths: paths, fails: fails }; });
  }
  function signedUrls(paths) {
    return runSeq(paths || [], function (p) {
      return sb.storage.from(BUCKET).createSignedUrl(p, 900).then(function (r) { return r && r.data ? r.data.signedUrl : null; }, function () { return null; });
    });
  }

  /* -------------------------------------------- student-review snapshots */
  // Everything a student may be shown, computed here (the student never gets
  // seeds or keys). Question text is included ONLY for "questions" mode.
  function buildReview(sheet, itemMap, withQuestions) {
    var v = versionFromAnswers(sheet, sheet.answers), items = itemsFor(sheet, v) || versionSets(sheet)[0];
    var per = {}; (sheet.per_item || []).forEach(function (p) { per[p.q] = p; });
    var out = [];
    items.forEach(function (it) {
      var a = (sheet.answers || {})[it.q] || {}, p = per[it.q] || {};
      var row = { q: it.q, kind: it.kind, points: it.points, earned: p.earned != null ? p.earned : 0, correct_flag: !!p.correct,
        your: displayValue(it, a.value), correct: correctDisplay(it), edited: !!a.edited };
      if (it.kind === 'mc' || it.kind === 'yn') {
        row.yi = a.value == null || a.value === '' ? null : (it.kind === 'yn' ? (a.value === 'yes' ? 0 : 1) : Number(a.value));
        row.ci = row.correct && row.correct.length === 1 ? (it.kind === 'yn' ? (row.correct === 'Y' ? 0 : 1) : row.correct.charCodeAt(0) - 65) : null;
      }
      if (withQuestions) {
        var r = itemMap[String(it.item_id)] || {}, gen = genFor(r, it.seed);
        row.prompt = gen && gen.prompt ? gen.prompt : (r.prompt || '');
        if (it.kind === 'mc') {
          var opts = (gen && gen.options) ? gen.options : (r.options || []);
          row.options = opts.map(function (o, i) { return stripLetter(opts[it.perm ? it.perm[i] : i]); });
        }
        var fig = figureFor(gen); if (fig) { row.figure = fig; }
      }
      out.push(row);
    });
    var base = versionSets(sheet)[0] || [];
    return { layout: base.map(function (it) { return { q: it.q, kind: it.kind, nopts: it.nopts }; }),
      versions: isVersioned(sheet) ? versionSets(sheet).length : 0, version: v, items: out };
  }
  function displayValue(it, v) {
    if (v == null || v === '') { return ''; }
    if (it.kind === 'mc') { return letter(Number(v)); }
    if (it.kind === 'yn') { return v === 'yes' ? 'Y' : 'N'; }
    return String(v);
  }

  /* --------------------------------------------------------- saving */
  function gradeAndSave(C) {
    var noVersion = 0;
    var todo = C.sheets.filter(function (e) {
      if (!e.sheet.student_id && !e.assignTo) { return false; }
      if (isVersioned(e.sheet) && e.version == null) { noVersion++; return false; }
      return true;
    });
    if (!todo.length) { say('swGradeMsg', noVersion ? 'Pick the booklet version for the flagged sheets first.' : 'Nothing to save \u2014 assign the spare sheets to students first.', 'err'); return; }
    var ids = {};
    todo.forEach(function (e) { itemsFor(e.sheet, e.version).forEach(function (it) { ids[String(it.item_id)] = true; }); });
    el('swGrade').disabled = true;
    say('swGradeMsg', 'Grading\u2026');
    var itemMap = {}, scanFails = 0, scanOk = 0;
    fetchItems(Object.keys(ids)).then(function (m) {
      itemMap = m;
      return loadStaticKeys(Object.keys(ids).filter(function (id) { return !(m[id] && m[id].generator_id); }));
    }).then(function () {
      var now = new Date().toISOString(), uid = State.user ? State.user.id : null;
      var ups = [], scoreRows = [], unknown = 0;
      todo.forEach(function (e) {
        var items = itemsFor(e.sheet, e.version);
        var g = gradeItems(items, e.answers, itemMap);
        unknown += g.unknownKey;
        var sid = e.sheet.student_id || e.assignTo, ans = {};
        if (e.answers.V) { ans.V = { value: e.answers.V.value, status: e.answers.V.status, edited: !!e.answers.V.edited }; }
        items.forEach(function (it) { var a = e.answers[it.q]; ans[it.q] = a ? { value: a.value, status: a.status, edited: !!a.edited } : { value: null, status: 'not_scanned' }; });
        ups.push({ e: e, sheet: e.sheet, sid: sid, patch: { student_id: sid, answers: ans, per_item: g.per, score: g.score, max_score: g.max, status: 'graded', graded_at: now, graded_by: uid } });
        scoreRows.push({ exam_id: S.examId, student_id: sid, course_id: S.courseId, points: g.score, updated_by: uid, updated_at: now });
      });
      var voids = [];
      ups.forEach(function (u) {
        if (!u.sheet.student_id) { S.sheets.forEach(function (s) { if (s.student_id === u.sid && s.id !== u.sheet.id && s.status !== 'void') { voids.push(s.id); } }); }
      });
      return runSeq(chunk(voids, 100), function (part) {
        return sb.from('im_paper_sheet').update({ status: 'void' }).in('id', part).then(function (r) { if (r.error) { throw new Error(r.error.message); } });
      }).then(function () {
        return runSeq(ups, function (u, i) {
          say('swGradeMsg', 'Saving ' + (i + 1) + ' of ' + ups.length + ' (with scans)\u2026');
          return uploadScans(u.e).then(function (up) {
            scanFails += up.fails; scanOk += up.paths.length;
            if (up.paths.length) { u.patch.scan_paths = up.paths; }
            return sb.from('im_paper_sheet').update(u.patch).eq('id', u.sheet.id).then(function (r) {
              if (r.error && u.patch.scan_paths && /scan_paths/.test(r.error.message)) { delete u.patch.scan_paths; return sb.from('im_paper_sheet').update(u.patch).eq('id', u.sheet.id); }
              return r;
            }).then(function (r) { if (r && r.error) { throw new Error('Sheet ' + u.sheet.code + ': ' + r.error.message); } });
          });
        });
      }).then(function () {
        return runSeq(chunk(scoreRows, 100), function (part) {
          return sb.from('im_manual_exam_score').upsert(part, { onConflict: 'exam_id,student_id' }).then(function (r) { if (r.error) { throw new Error('Gradebook: ' + r.error.message); } });
        });
      }).then(function () { return { n: scoreRows.length, unknown: unknown }; });
    }).then(function (res) {
      return loadBase().then(function () { return loadReviewData(); }).then(function () { return refreshSnapshots(null); }).then(function () {
        S.scan = null;
        show('results');
        say('swResMsg', 'Saved ' + res.n + ' score' + (res.n === 1 ? '' : 's') + ' to the gradebook' +
          (scanOk ? ' and stored ' + scanOk + ' scanned page' + (scanOk === 1 ? '' : 's') : '') + '.' +
          (scanFails ? ' ' + scanFails + ' page(s) could not be stored (' + (S.lastUploadError || 'storage error') + ' \u2014 run im_78_paper_review.sql).' : '') +
          (noVersion ? ' ' + noVersion + ' sheet(s) skipped: no booklet version chosen.' : '') +
          (res.unknown ? ' ' + res.unknown + ' answer(s) had no readable bank key and were marked wrong \u2014 check the item bank.' : ''),
          (res.unknown || noVersion || scanFails) ? 'err' : 'ok');
      });
    }).catch(function (err) {
      var b = el('swGrade'); if (b) { b.disabled = false; }
      say('swGradeMsg', err && err.message ? err.message : String(err), 'err');
    });
  }

  /* ------------------------------------------------ release + snapshots */
  function loadReviewData() {
    return Promise.all([
      sb.from('im_paper_release').select('*').eq('exam_id', S.examId),
      sb.from('im_paper_regrade').select('*').eq('exam_id', S.examId).order('created_at', { ascending: true })
    ]).then(function (r) {
      S.reviewReady = !(r[0].error && /relation|does not exist|schema cache/i.test(r[0].error.message));
      S.release = (r[0].data && r[0].data[0]) || null;
      S.requests = r[1].data || [];
    }, function () { S.reviewReady = false; S.release = null; S.requests = []; });
  }
  // Rebuild the student snapshot for the given sheets (null = every graded sheet) if released.
  function refreshSnapshots(onlyIds) {
    if (!S.release || !S.release.released_at) { return Promise.resolve(); }
    var list = S.sheets.filter(function (s) { return s.status === 'graded' && (!onlyIds || onlyIds.indexOf(s.id) >= 0); });
    return writeSnapshots(list, S.release.mode === 'questions');
  }
  function writeSnapshots(list, withQ) {
    var ids = {};
    list.forEach(function (s) { versionSets(s).forEach(function (set) { set.forEach(function (it) { ids[String(it.item_id)] = true; }); }); });
    return fetchItems(Object.keys(ids)).then(function (map) {
      return loadStaticKeys(Object.keys(ids).filter(function (id) { return !(map[id] && map[id].generator_id); })).then(function () { return map; });
    }).then(function (map) {
      var now = new Date().toISOString();
      return runSeq(list, function (s) {
        var snap = buildReview(s, map, withQ);
        s.review = snap;
        return sb.from('im_paper_sheet').update({ review: snap, released_at: now }).eq('id', s.id).then(function (r) { if (r.error) { throw new Error(r.error.message); } });
      });
    });
  }

  /* ======================================================= TAB 3: results */
  function renderResults() {
    var host = el('swBody');
    host.innerHTML = '<div class="msg" id="swResMsg" style="display:none;margin-bottom:10px;"></div>' + ((typeof loadingCard === 'function') ? loadingCard() : '');
    loadReviewData().then(function () { renderResultsBody(); });
  }
  function fmtDT(v) { if (!v) { return ''; } var d = new Date(v); return isNaN(d.getTime()) ? '' : d.toLocaleString(); }
  function toLocalInput(v) { if (!v) { return ''; } var d = new Date(v); if (isNaN(d.getTime())) { return ''; } var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function renderResultsBody() {
    var keepMsg = el('swResMsg') ? { t: el('swResMsg').textContent, c: el('swResMsg').className, d: el('swResMsg').style.display } : null;
    var graded = S.sheets.filter(function (s) { return s.status === 'graded'; });
    var html = '<div class="msg" id="swResMsg" style="display:none;margin-bottom:10px;"></div>';
    if (!graded.length) { el('swBody').innerHTML = html + '<div class="card empty">No sheets graded yet.</div>'; return; }
    var sum = 0, max = 0; graded.forEach(function (s) { sum += Number(s.score) || 0; max += Number(s.max_score) || 0; });
    var openReq = S.requests.filter(function (q) { return q.status === 'open'; });
    html += '<div class="card" style="margin-bottom:14px;display:flex;gap:22px;flex-wrap:wrap;align-items:center;">' +
      stat(graded.length, 'sheets graded') + stat(max ? Math.round(sum / max * 1000) / 10 + '%' : '\u2014', 'class average') +
      stat(openReq.length, 'open regrade requests', openReq.length) +
      '<div style="flex:1"></div><button class="btn btn-ghost btn-sm" id="swRegrade">Re-grade all</button><button class="btn btn-ghost btn-sm" id="swCsv">Results (CSV)</button></div>';
    html += releaseCardHTML();
    if (S.requests.length) { html += requestsCardHTML(); }
    html += '<div class="card" style="margin-bottom:14px;"><div style="font-weight:700;margin-bottom:8px;">Students</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Student</th><th>Sheet</th><th>Version</th><th>Score</th><th>Edited</th><th>Scan</th><th></th></tr></thead><tbody>' +
      graded.slice().sort(function (a, b) { var x = nameOf(a).toLowerCase(), y = nameOf(b).toLowerCase(); return x < y ? -1 : (x > y ? 1 : 0); }).map(function (s) {
        var ed = 0; if (s.answers) { for (var q in s.answers) { if (s.answers[q] && s.answers[q].edited) { ed++; } } }
        var v = versionFromAnswers(s, s.answers), reqs = openReq.filter(function (r) { return r.sheet_id === s.id; }).length;
        return '<tr><td>' + h(nameOf(s)) + (reqs ? ' <span class="tag amber">' + reqs + ' request' + (reqs > 1 ? 's' : '') + '</span>' : '') + '</td><td><span class="tag dim">' + h(s.code) + '</span></td><td>' + (v == null ? '\u2014' : letter(v)) + '</td><td>' + h(s.score) + ' / ' + h(s.max_score) + '</td><td>' + (ed || '') + '</td><td>' + ((s.scan_paths && s.scan_paths.length) ? '\u2713' : '\u2014') + '</td>' +
          '<td><button class="btn btn-ghost btn-sm" data-swopen="' + h(s.id) + '">Open</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
    html += hardestHTML(graded);
    el('swBody').innerHTML = html;
    if (keepMsg && keepMsg.t) { var m = el('swResMsg'); m.textContent = keepMsg.t; m.className = keepMsg.c; m.style.display = keepMsg.d; }
    el('swCsv').addEventListener('click', function () {
      var lines = ['student,email,sheet,version,score,max'];
      graded.forEach(function (s) { var st = S.rosterById[s.student_id] || {}, v = versionFromAnswers(s, s.answers); lines.push([csv(nameOf(s)), csv(st.email || ''), s.code, v == null ? '' : letter(v), s.score, s.max_score].join(',')); });
      saveText(lines.join('\n'), fileBase() + '_results.csv');
    });
    el('swRegrade').addEventListener('click', function () { regradeAll(graded); });
    Array.prototype.forEach.call(el('swBody').querySelectorAll('[data-swopen]'), function (b) {
      b.addEventListener('click', function () { openSheetView(b.getAttribute('data-swopen'), null, null); });
    });
    Array.prototype.forEach.call(el('swBody').querySelectorAll('[data-swreq]'), function (b) {
      b.addEventListener('click', function () {
        var rq = S.requests.filter(function (x) { return x.id === b.getAttribute('data-swreq'); })[0];
        if (rq) { openSheetView(rq.sheet_id, rq.q, rq); }
      });
    });
    wireReleaseCard();
  }
  function hardestHTML(graded) {
    var items = {};
    graded.forEach(function (s) {
      (s.per_item || []).forEach(function (p) {
        var k = String(p.item_id), o = items[k] || (items[k] = { id: k, n: 0, right: 0, blank: 0 });
        o.n++; if (p.correct) { o.right++; } if (p.answer == null) { o.blank++; }
      });
    });
    var list = Object.keys(items).map(function (k) { return items[k]; }).sort(function (a, b) { return a.right / a.n - b.right / b.n; });
    return '<div class="card"><div style="font-weight:700;margin-bottom:8px;">Hardest questions</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Lowest share correct first. A very low number on an easy topic often means a key problem.</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th>Students</th><th>Correct</th><th>Blank</th></tr></thead><tbody>' +
      list.slice(0, 12).map(function (o) {
        var pct = Math.round(o.right / o.n * 100);
        return '<tr><td style="font-family:monospace;font-size:11.5px;">' + h(o.id) + '</td><td>' + o.n + '</td><td>' + pct + '%' + (pct < 25 && o.n >= 5 ? ' <span class="tag rose">check key</span>' : '') + '</td><td>' + o.blank + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  var MODE_TXT = {
    score: 'Score only \u2014 total plus their own scanned sheet',
    answers: 'Answers \u2014 plus each question\u2019s their answer / correct answer / points, no question text (recommended)',
    questions: 'Full questions \u2014 plus question text and graphs, in a protected, watermarked viewer'
  };
  function releaseCardHTML() {
    if (!S.reviewReady) { return '<div class="card" style="margin-bottom:14px;border-left:4px solid var(--warn,#d97706);"><b>Student review is not installed yet.</b> <span style="font-size:12.5px;color:var(--text-muted);">Run im_78_paper_review.sql in the Supabase SQL editor, then reopen this window.</span></div>'; }
    var r = S.release || {}, on = !!r.released_at;
    var weekAhead = new Date(Date.now() + 7 * 864e5).toISOString();
    return '<div class="card" style="margin-bottom:14px;"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;"><div style="font-weight:700;flex:1;">Student review</div>' +
      (on ? '<span class="tag green">Released ' + h(fmtDT(r.released_at)) + '</span>' : '<span class="tag dim">Not released</span>') + '</div>' +
      '<label class="fld">What students see<select id="swRelMode">' + ['score', 'answers', 'questions'].map(function (m) { return '<option value="' + m + '"' + ((r.mode || 'answers') === m ? ' selected' : '') + '>' + MODE_TXT[m] + '</option>'; }).join('') + '</select></label>' +
      '<div id="swRelWarn" style="font-size:12px;margin:-2px 0 8px;color:var(--warn,#d97706);"></div>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
      '<label class="fld" style="min-width:190px;">Opens<input type="datetime-local" id="swRelOpen" value="' + h(toLocalInput(r.opens_at || new Date().toISOString())) + '"></label>' +
      '<label class="fld" style="min-width:190px;">Closes (blank = stays open)<input type="datetime-local" id="swRelClose" value="' + h(toLocalInput(r.closes_at)) + '"></label>' +
      '<label class="fld" style="min-width:190px;">Regrade requests until<input type="datetime-local" id="swRelRegrade" value="' + h(toLocalInput(r.regrade_until || weekAhead)) + '"></label></div>' +
      '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:4px 0 10px;"><input type="checkbox" id="swRelWm"' + (r.watermark === false ? '' : ' checked') + '> Watermark every page with the student\u2019s email and the time</label>' +
      '<div class="inline-actions"><button class="btn btn-primary btn-sm" id="swRelSave">' + (on ? 'Update release' : 'Release to students') + '</button>' +
      (on ? '<button class="btn btn-ghost btn-sm" id="swRelHide">Hide from students</button>' : '') + '</div></div>';
  }
  function wireReleaseCard() {
    if (!el('swRelSave')) { return; }
    function warn() {
      var m = el('swRelMode').value, w = el('swRelWarn');
      if (m !== 'questions') { w.textContent = ''; return; }
      w.textContent = 'Students will see the question text. Screenshots and phone photos can\u2019t be fully prevented \u2014 prefer a short window (e.g. 48 hours) and keep drawing future exams from the generated bank.';
      exposureCount().then(function (n) { if (n && el('swRelWarn')) { el('swRelWarn').textContent += ' ' + n + ' of these questions were already shown in an earlier full release.'; } });
    }
    el('swRelMode').addEventListener('change', warn); warn();
    el('swRelSave').addEventListener('click', saveRelease);
    if (el('swRelHide')) {
      el('swRelHide').addEventListener('click', function () {
        sb.from('im_paper_release').update({ released_at: null, updated_at: new Date().toISOString() }).eq('exam_id', S.examId).then(function (r) {
          if (r.error) { say('swResMsg', r.error.message, 'err'); return; }
          loadReviewData().then(function () { renderResultsBody(); say('swResMsg', 'Hidden. Students can no longer open this review.', 'ok'); });
        });
      });
    }
  }
  function examItemIds() {
    var o = {};
    S.sheets.forEach(function (s) { if (s.status === 'graded') { versionSets(s).forEach(function (set) { set.forEach(function (it) { o[String(it.item_id)] = true; }); }); } });
    return Object.keys(o);
  }
  function exposureCount() {
    return sb.from('im_paper_release').select('exam_id,exposed_items,mode').eq('mode', 'questions').then(function (r) {
      var seen = {}; (r.data || []).forEach(function (x) { if (String(x.exam_id) !== String(S.examId)) { (x.exposed_items || []).forEach(function (id) { seen[String(id)] = true; }); } });
      return examItemIds().filter(function (id) { return seen[id]; }).length;
    }, function () { return 0; });
  }
  function isoOrNull(v) { if (!v) { return null; } var d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); }
  function saveRelease() {
    var mode = el('swRelMode').value;
    var row = { exam_id: S.examId, course_id: S.courseId, mode: mode, opens_at: isoOrNull(el('swRelOpen').value),
      closes_at: isoOrNull(el('swRelClose').value), regrade_until: mode === 'score' ? null : isoOrNull(el('swRelRegrade').value),
      watermark: el('swRelWm').checked, exposed_items: mode === 'questions' ? examItemIds() : null,
      released_at: new Date().toISOString(), released_by: State.user ? State.user.id : null, updated_at: new Date().toISOString() };
    if (row.closes_at && row.opens_at && row.closes_at <= row.opens_at) { say('swResMsg', 'The close time must be after the open time.', 'err'); return; }
    el('swRelSave').disabled = true;
    say('swResMsg', 'Preparing each student\u2019s review\u2026');
    sb.from('im_paper_release').upsert(row, { onConflict: 'exam_id' }).then(function (r) {
      if (r.error) { throw new Error(r.error.message); }
      S.release = row;
      var graded = S.sheets.filter(function (s) { return s.status === 'graded'; });
      return writeSnapshots(graded, mode === 'questions').then(function () { return graded.length; });
    }).then(function (n) {
      return loadReviewData().then(function () { renderResultsBody(); say('swResMsg', 'Released to ' + n + ' student' + (n === 1 ? '' : 's') + ' (' + mode + ' mode).', 'ok'); });
    }).catch(function (err) { if (el('swRelSave')) { el('swRelSave').disabled = false; } say('swResMsg', err.message || String(err), 'err'); });
  }

  var REQ_TAG = { open: 'amber', accepted: 'green', declined: 'rose', withdrawn: 'dim' };
  function requestsCardHTML() {
    var byId = {}; S.sheets.forEach(function (s) { byId[s.id] = s; });
    var list = S.requests.slice().sort(function (a, b) { return (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || (a.created_at < b.created_at ? -1 : 1); });
    return '<div class="card" style="margin-bottom:14px;"><div style="font-weight:700;margin-bottom:8px;">Regrade requests</div>' +
      list.map(function (q) {
        var s = byId[q.sheet_id];
        return '<div style="border-top:1px solid var(--border);padding:8px 0;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;">' +
          '<div style="flex:1;min-width:240px;"><b>' + h(s ? nameOf(s) : q.student_id) + '</b> \u00b7 Q' + h(q.q) + ' <span class="tag ' + (REQ_TAG[q.status] || 'dim') + '">' + h(q.status) + '</span> <span style="font-size:11.5px;color:var(--text-subtle);">' + h(fmtDT(q.created_at)) + '</span>' +
          '<div style="font-size:13px;margin-top:4px;">\u201c' + h(q.reason) + '\u201d</div>' + (q.reply ? '<div style="font-size:12px;color:var(--text-muted);margin-top:3px;">Reply: ' + h(q.reply) + '</div>' : '') + '</div>' +
          (q.status === 'open' ? '<button class="btn btn-primary btn-sm" data-swreq="' + h(q.id) + '">Review</button>' : '') + '</div>';
      }).join('') + '</div>';
  }

  /* ---------------------------------------------- one student's sheet */
  function sheetById(id) { for (var i = 0; i < S.sheets.length; i++) { if (S.sheets[i].id === id) { return S.sheets[i]; } } return null; }
  function openSheetView(sheetId, focusQ, request) {
    var s = sheetById(sheetId); if (!s) { return; }
    var host = el('swBody');
    host.innerHTML = '<div class="inline-actions" style="margin-bottom:10px;"><button class="btn btn-ghost btn-sm" id="swBack">\u2190 All students</button><div style="flex:1"></div><b>' + h(nameOf(s)) + '</b>&nbsp;<span class="tag dim">' + h(s.code) + '</span></div>' +
      '<div class="msg" id="swSvMsg" style="display:none;margin-bottom:8px;"></div><div id="swSvBody">' + ((typeof loadingCard === 'function') ? loadingCard() : '') + '</div>';
    el('swBack').addEventListener('click', function () { renderResultsBody(); });
    var ids = {}; versionSets(s).forEach(function (set) { set.forEach(function (it) { ids[String(it.item_id)] = true; }); });
    Promise.all([
      fetchItems(Object.keys(ids)).then(function (m) { return loadStaticKeys(Object.keys(ids).filter(function (id) { return !(m[id] && m[id].generator_id); })).then(function () { return m; }); }),
      signedUrls(s.scan_paths),
      sb.from('im_paper_change').select('*').eq('sheet_id', s.id).order('changed_at', { ascending: false }).then(function (r) { return r.data || []; }, function () { return []; })
    ]).then(function (r) {
      S.sv = { sheet: s, itemMap: r[0], urls: r[1], history: r[2], focusQ: focusQ, request: request };
      renderSheetView();
    }).catch(function (err) { el('swSvBody').innerHTML = '<div class="msg err" style="display:block;">' + h(err.message || String(err)) + '</div>'; });
  }
  function sheetMarks(s, items) {
    var per = {}; (s.per_item || []).forEach(function (p) { per[p.q] = p; });
    var marks = {};
    items.forEach(function (it) {
      var a = (s.answers || {})[it.q] || {}, p = per[it.q] || {}, c = correctDisplay(it);
      marks[it.q] = { kind: it.kind, value: a.value, correct: !!p.correct, edited: !!a.edited,
        yi: a.value == null || a.value === '' ? null : (it.kind === 'yn' ? (a.value === 'yes' ? 0 : 1) : (it.kind === 'mc' ? Number(a.value) : null)),
        ci: (it.kind === 'mc' && c.length === 1) ? c.charCodeAt(0) - 65 : (it.kind === 'yn' ? (c === 'Y' ? 0 : 1) : null),
        text: it.kind === 'num' ? (a.value == null ? '(blank)' : String(a.value)) + (p.correct ? '' : ' \u2192 ' + c) : null };
    });
    return marks;
  }
  function renderSheetView() {
    var sv = S.sv, s = sv.sheet, v = versionFromAnswers(s, s.answers), items = itemsFor(s, v) || versionSets(s)[0];
    var L = layoutFor(s), marks = sheetMarks(s, items);
    var per = {}; (s.per_item || []).forEach(function (p) { per[p.q] = p; });
    var scans = '';
    if (sv.urls && sv.urls.length) {
      sv.urls.forEach(function (u, i) {
        if (!u) { return; }
        scans += '<div style="position:relative;margin-bottom:10px;border:1px solid var(--border);background:#fff;">' +
          '<img src="' + h(u) + '" style="display:block;width:100%;height:auto;">' + overlaySVG(L.pages[i], marks, true) + '</div>';
      });
    } else { scans = '<div class="card empty">No stored scan for this sheet (graded before scans were kept, or storage isn\u2019t installed).</div>'; }
    var rows = items.map(function (it) {
      var a = (s.answers || {})[it.q] || {}, p = per[it.q] || {}, foc = String(sv.focusQ) === String(it.q);
      var tag = a.edited ? '<span class="tag amber">edited</span>' : (a.status && a.status !== 'ok' && a.status !== 'erasure' ? '<span class="tag dim">' + h(a.status) + '</span>' : '');
      return '<tr' + (foc ? ' style="outline:2px solid var(--warn,#d97706);"' : '') + '><td>Q' + it.q + '</td><td>' + h(displayValue(it, a.value) || '\u2014') + '</td><td>' + h(correctDisplay(it)) + '</td>' +
        '<td>' + h(p.earned != null ? p.earned : 0) + ' / ' + it.points + (p.override != null ? ' <span class="tag amber">override</span>' : '') + '</td><td>' + tag + '</td>' +
        '<td><button class="btn btn-ghost btn-sm" data-swedit="' + it.q + '">' + (foc && sv.request ? 'Resolve' : 'Edit') + '</button></td></tr>' +
        '<tr id="swEd' + it.q + '" style="display:none;"><td colspan="6"></td></tr>';
    }).join('');
    var hist = sv.history.length ? '<div style="font-weight:700;margin:12px 0 6px;">Change history</div>' + sv.history.map(function (c) {
      return '<div style="font-size:12px;color:var(--text-muted);border-top:1px solid var(--border);padding:4px 0;">' + h(fmtDT(c.changed_at)) + ' \u00b7 Q' + h(c.q) + ': ' + h(c.old_value || '\u2014') + ' \u2192 ' + h(c.new_value || '\u2014') +
        ' \u00b7 score ' + h(c.old_score) + ' \u2192 ' + h(c.new_score) + (c.source === 'regrade' ? ' \u00b7 regrade' : '') + (c.note ? ' \u00b7 \u201c' + h(c.note) + '\u201d' : '') + '</div>';
    }).join('') : '';
    var req = sv.request ? '<div class="card" style="margin-bottom:10px;border-left:4px solid var(--warn,#d97706);"><b>Regrade request \u00b7 Q' + h(sv.request.q) + '</b><div style="font-size:13px;margin-top:4px;">\u201c' + h(sv.request.reason) + '\u201d</div></div>' : '';
    el('swSvBody').innerHTML = req + '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">' +
      '<div style="flex:1 1 380px;min-width:300px;">' + scans + '</div>' +
      '<div style="flex:1 1 360px;min-width:300px;"><div style="font-size:22px;font-weight:800;margin-bottom:6px;">' + h(s.score) + ' / ' + h(s.max_score) + '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Green = marked correct, red = marked wrong, dashed green = the right answer, amber = changed by staff.</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Q</th><th>Marked</th><th>Correct</th><th>Points</th><th></th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' + hist + '</div></div>';
    Array.prototype.forEach.call(el('swSvBody').querySelectorAll('[data-swedit]'), function (b) {
      b.addEventListener('click', function () { openEditor(Number(b.getAttribute('data-swedit'))); });
    });
    if (sv.focusQ != null) { openEditor(Number(sv.focusQ)); }
  }
  // SVG overlay in page points; the stored scan is template-aligned so it lines up exactly.
  function overlaySVG(page, marks, showCorrect) {
    if (!page) { return ''; }
    var o = ['<svg viewBox="0 0 ' + SheetwiseCore.PAGE_W + ' ' + SheetwiseCore.PAGE_H + '" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;">'];
    page.groups.forEach(function (g) {
      var m = marks[g.q]; if (!m) { return; }
      var col = m.edited ? '#d97706' : (m.correct ? '#16a34a' : '#dc2626');
      if (g.type === 'choice') {
        if (showCorrect && m.ci != null && !m.correct && g.bubbles[m.ci]) { var cb = g.bubbles[m.ci]; o.push('<circle cx="' + cb.x + '" cy="' + cb.y + '" r="' + (cb.r + 2.2) + '" fill="none" stroke="#16a34a" stroke-width="1.4" stroke-dasharray="2 1.5"/>'); }
        if (m.yi != null && g.bubbles[m.yi]) { var yb = g.bubbles[m.yi]; o.push('<circle cx="' + yb.x + '" cy="' + yb.y + '" r="' + (yb.r + 1.4) + '" fill="none" stroke="' + col + '" stroke-width="1.8"/>'); }
        else if (m.yi == null) { o.push('<text x="' + (g.bubbles[g.bubbles.length - 1].x + 11) + '" y="' + (g.bubbles[0].y + 3) + '" font-size="8" font-family="Helvetica" fill="' + col + '">blank</text>'); }
      } else if (g.type === 'num') {
        o.push('<rect x="' + g.bbox.x + '" y="' + g.bbox.y + '" width="' + g.bbox.w + '" height="' + g.bbox.h + '" fill="none" stroke="' + col + '" stroke-width="1.6" rx="3"/>');
        if (m.text && showCorrect) { o.push('<rect x="' + (g.bbox.x + 22) + '" y="' + (g.bbox.y + 1) + '" width="' + (g.bbox.w - 24) + '" height="11" fill="#fff" opacity="0.9"/><text x="' + (g.bbox.x + 24) + '" y="' + (g.bbox.y + 10) + '" font-size="8.5" font-weight="700" font-family="Helvetica" fill="' + col + '">' + h(m.text) + '</text>'); }
      }
    });
    o.push('</svg>');
    return o.join('');
  }
  function openEditor(q) {
    var sv = S.sv, s = sv.sheet, v = versionFromAnswers(s, s.answers), items = itemsFor(s, v) || versionSets(s)[0];
    var it = items.filter(function (x) { return x.q === q; })[0]; if (!it) { return; }
    var rowEl = el('swEd' + q); if (!rowEl) { return; }
    var a = (s.answers || {})[q] || {}, per = (s.per_item || []).filter(function (p) { return p.q === q; })[0] || {};
    var ctl;
    if (it.kind === 'num') { ctl = '<input type="text" id="swEdVal" value="' + h(a.value == null ? '' : a.value) + '" placeholder="number (blank = no answer)" style="width:160px">'; }
    else {
      var labels = it.kind === 'yn' ? ['Y', 'N'] : letters(it.nopts);
      ctl = '<select id="swEdVal"><option value="">(blank)</option>' + labels.map(function (lb, i) {
        var val = it.kind === 'yn' ? (i === 0 ? 'yes' : 'no') : String(i);
        return '<option value="' + val + '"' + (String(a.value) === val ? ' selected' : '') + '>' + lb + '</option>';
      }).join('') + '</select>';
    }
    var isReq = sv.request && String(sv.request.q) === String(q) && sv.request.status === 'open';
    rowEl.style.display = '';
    rowEl.firstChild.innerHTML = '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;padding:6px 0;">' +
      '<label class="fld" style="margin:0;">Answer' + ctl + '</label>' +
      '<label class="fld" style="margin:0;width:150px;">Points override<input type="number" id="swEdPts" min="0" max="' + it.points + '" step="0.5" value="' + h(per.override != null ? per.override : '') + '" placeholder="auto"></label>' +
      '<label class="fld" style="margin:0;flex:1;min-width:180px;">' + (isReq ? 'Reply to student' : 'Note (optional)') + '<input type="text" id="swEdNote" maxlength="500"></label>' +
      '<button class="btn btn-primary btn-sm" id="swEdSave">' + (isReq ? 'Accept &amp; save' : 'Save change') + '</button>' +
      (isReq ? '<button class="btn btn-ghost btn-sm" id="swEdDecline">Decline</button>' : '') + '</div>';
    el('swEdSave').addEventListener('click', function () {
      var val = el('swEdVal').value.replace(/\s+/g, '').replace(/\u2212/g, '-');
      if (it.kind === 'num' && val !== '' && !/^-?(\d+\.?\d*|\.\d+)$/.test(val)) { say('swSvMsg', 'Not a valid number.', 'err'); return; }
      var pts = el('swEdPts').value === '' ? null : Number(el('swEdPts').value);
      if (pts !== null && (isNaN(pts) || pts < 0 || pts > it.points)) { say('swSvMsg', 'Points must be between 0 and ' + it.points + '.', 'err'); return; }
      applyEdit(s, it, val === '' ? null : val, pts, el('swEdNote').value.trim(), isReq ? sv.request : null);
    });
    if (isReq) {
      el('swEdDecline').addEventListener('click', function () {
        var reply = el('swEdNote').value.trim();
        if (!reply) { say('swSvMsg', 'Write a short reply so the student knows why.', 'err'); return; }
        resolveRequest(sv.request, 'declined', reply).then(function () { afterEdit(s, 'Declined.'); });
      });
    }
  }
  function resolveRequest(rq, status, reply) {
    return sb.from('im_paper_regrade').update({ status: status, reply: reply || null, resolved_by: State.user ? State.user.id : null, resolved_at: new Date().toISOString() })
      .eq('id', rq.id).then(function (r) { if (r.error) { throw new Error(r.error.message); } });
  }
  function applyEdit(s, it, newVal, pts, note, rq) {
    say('swSvMsg', 'Saving\u2026');
    var answers = JSON.parse(JSON.stringify(s.answers || {}));
    var old = answers[it.q] || {}, oldScore = Number(s.score) || 0;
    answers[it.q] = { value: newVal, status: 'edited', edited: true, override: pts, read: old.read !== undefined ? old.read : old.value };
    var items = itemsFor(s, versionFromAnswers(s, answers)) || versionSets(s)[0];
    var g = gradeItems(items, answers, S.sv.itemMap);
    var now = new Date().toISOString(), uid = State.user ? State.user.id : null;
    sb.from('im_paper_sheet').update({ answers: answers, per_item: g.per, score: g.score, max_score: g.max, graded_at: now, graded_by: uid }).eq('id', s.id).then(function (r) {
      if (r.error) { throw new Error(r.error.message); }
      s.answers = answers; s.per_item = g.per; s.score = g.score; s.max_score = g.max;
      return sb.from('im_paper_change').insert({ sheet_id: s.id, exam_id: S.examId, course_id: S.courseId, q: String(it.q),
        old_value: displayValue(it, old.value) + (old.override != null ? ' [' + old.override + ' pts]' : ''),
        new_value: displayValue(it, newVal) + (pts != null ? ' [' + pts + ' pts]' : ''),
        old_score: oldScore, new_score: g.score, note: note || null, source: rq ? 'regrade' : 'edit' });
    }).then(function (r) {
      if (r && r.error) { throw new Error('Audit log: ' + r.error.message); }
      return sb.from('im_manual_exam_score').upsert({ exam_id: S.examId, student_id: s.student_id, course_id: S.courseId, points: g.score, updated_by: uid, updated_at: now }, { onConflict: 'exam_id,student_id' });
    }).then(function (r) {
      if (r && r.error) { throw new Error('Gradebook: ' + r.error.message); }
      return rq ? resolveRequest(rq, 'accepted', note) : null;
    }).then(function () { return refreshSnapshots([s.id]); })
      .then(function () { afterEdit(s, 'Saved. Score ' + oldScore + ' \u2192 ' + g.score + (rq ? '; request accepted.' : '.')); })
      .catch(function (err) { say('swSvMsg', err.message || String(err), 'err'); });
  }
  function afterEdit(s, msg) {
    loadReviewData().then(function () {
      return sb.from('im_paper_change').select('*').eq('sheet_id', s.id).order('changed_at', { ascending: false }).then(function (r) { S.sv.history = r.data || []; });
    }).then(function () {
      S.sv.request = null; S.sv.focusQ = null;
      renderSheetView(); say('swSvMsg', msg, 'ok');
    });
  }

  function nameOf(s) { var st = S.rosterById[s.student_id]; return st ? st.name : (s.student_label || s.student_id || ''); }

  function regradeAll(graded) {
    if (!confirm('Re-grade all ' + graded.length + ' sheets from their saved answers (e.g. after fixing a question)? Staff edits and point overrides are kept.')) { return; }
    var ids = {};
    graded.forEach(function (s) { versionSets(s).forEach(function (set) { set.forEach(function (it) { ids[String(it.item_id)] = true; }); }); });
    say('swResMsg', 'Re-grading\u2026');
    var itemMap;
    fetchItems(Object.keys(ids)).then(function (m) {
      itemMap = m; S.keys = {};
      return loadStaticKeys(Object.keys(ids).filter(function (id) { return !(m[id] && m[id].generator_id); }));
    }).then(function () {
      var now = new Date().toISOString(), uid = State.user ? State.user.id : null, changed = 0, rows = [];
      return runSeq(graded, function (s) {
        var items = itemsFor(s, versionFromAnswers(s, s.answers)); if (!items) { return null; }
        var g = gradeItems(items, s.answers || {}, itemMap);
        if (Number(g.score) !== Number(s.score)) { changed++; }
        rows.push({ exam_id: S.examId, student_id: s.student_id, course_id: S.courseId, points: g.score, updated_by: uid, updated_at: now });
        return sb.from('im_paper_sheet').update({ per_item: g.per, score: g.score, max_score: g.max, graded_at: now, graded_by: uid }).eq('id', s.id)
          .then(function (r) { if (r.error) { throw new Error(r.error.message); } });
      }).then(function () {
        return runSeq(chunk(rows, 100), function (part) {
          return sb.from('im_manual_exam_score').upsert(part, { onConflict: 'exam_id,student_id' }).then(function (r) { if (r.error) { throw new Error(r.error.message); } });
        });
      }).then(function () { return changed; });
    }).then(function (changed) {
      return loadBase().then(function () { return loadReviewData(); }).then(function () { return refreshSnapshots(null); }).then(function () { renderResultsBody(); say('swResMsg', 'Re-graded. ' + changed + ' score(s) changed.', 'ok'); });
    }).catch(function (err) { say('swResMsg', err.message || String(err), 'err'); });
  }

  /* ==================================================================
     STUDENT SIDE  --  "Paper exams" in My Exams: review + regrade requests
     ================================================================== */
  var STU = null;
  function studentSection(host) {
    if (!host || typeof sb === 'undefined') { return; }
    var box = document.getElementById('swStuPaper');
    if (!box) { box = document.createElement('div'); box.id = 'swStuPaper'; host.appendChild(box); }
    sb.rpc('im_paper_my_list').then(function (r) {
      if (r.error || !r.data || !r.data.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<div style="font-size:11px;color:var(--text-subtle);text-transform:uppercase;letter-spacing:.07em;margin:18px 0 8px;">Paper exams</div>' +
        r.data.map(function (x) {
          var tag = x.is_open ? '<span class="tag green">Review open' + (x.closes_at ? ' until ' + h(fmtDT(x.closes_at)) : '') + '</span>' : '<span class="tag dim">Review closed</span>';
          return '<div class="card" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">' +
            '<div><div style="font-size:11px;color:var(--text-subtle);text-transform:uppercase;letter-spacing:.07em;">' + h(x.course_title || '') + ' \u00b7 paper</div>' +
            '<div style="font-size:18px;color:var(--text-bright);font-family:Instrument Serif,serif;">' + h(x.exam_title) + '</div>' +
            '<div style="font-size:12.5px;color:var(--text-muted);margin-top:3px;">Score ' + h(x.score) + ' / ' + h(x.max_score) + (x.open_requests ? ' \u00b7 ' + x.open_requests + ' regrade request(s) pending' : '') + '</div></div>' +
            '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">' + tag +
            (x.is_open ? '<button class="btn btn-primary btn-sm" data-swstu="' + h(x.sheet_id) + '">Review</button>' : '') + '</div></div>';
        }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('[data-swstu]'), function (b) {
        b.addEventListener('click', function () { openStudentReview(host, b.getAttribute('data-swstu')); });
      });
    }, function () { box.innerHTML = ''; });
  }

  function openStudentReview(host, sheetId) {
    host.innerHTML = (typeof loadingCard === 'function') ? loadingCard() : 'Loading\u2026';
    sb.rpc('im_paper_my_review', { p_sheet: sheetId }).then(function (r) {
      if (r.error) { host.innerHTML = '<div class="card"><p>' + h(r.error.message) + '</p><button class="btn btn-ghost btn-sm" id="swStuBack">Back</button></div>'; el('swStuBack').addEventListener('click', backToExams); return; }
      var d = r.data;
      return signedUrls(d.scan_paths || []).then(function (urls) { STU = { host: host, d: d, urls: urls }; renderStudentReview(); });
    });
  }
  function backToExams() {
    unprotect();
    if (typeof loadMyExams === 'function') { loadMyExams(); }
  }
  function renderStudentReview() {
    var d = STU.d, host = STU.host, items = d.items || [];
    var L = d.layout ? SheetwiseCore.layout(d.layout.map(function (x) { return { n: x.q, kind: x.kind, nopts: x.nopts }; }), { versions: d.versions || 0 }) : null;
    var marks = {};
    items.forEach(function (it) {
      marks[it.q] = { kind: it.kind, correct: !!it.correct_flag, edited: !!it.edited, yi: it.yi, ci: it.ci,
        text: it.kind === 'num' ? (it.your || '(blank)') + (it.correct_flag ? '' : ' \u2192 ' + (it.correct || '')) : null };
    });
    var reqByQ = {}; (d.requests || []).forEach(function (q) { (reqByQ[q.q] = reqByQ[q.q] || []).push(q); });
    var html = '<div id="swStuReview" class="sw-protect" style="position:relative;">' +
      '<div class="inline-actions" style="margin-bottom:10px;"><button class="btn btn-ghost btn-sm" id="swStuBack">\u2190 Back to exams</button></div>' +
      '<div class="card" style="margin-bottom:12px;"><div style="font-size:22px;font-family:Instrument Serif,serif;color:var(--text-bright);">' + h(d.exam_title) + '</div>' +
      '<div style="font-size:26px;font-weight:800;margin:4px 0;">' + h(d.score) + ' / ' + h(d.max_score) + '</div>' +
      '<div style="font-size:12.5px;color:var(--text-muted);">' + (d.closes_at ? 'Review open until ' + h(fmtDT(d.closes_at)) + '. ' : '') +
      (d.can_regrade ? 'You can ask for a regrade until ' + h(fmtDT(d.regrade_until)) + '.' : (d.mode === 'score' ? '' : 'Regrade requests are closed.')) + '</div></div>';
    // their own scanned sheet
    html += '<div class="card" style="margin-bottom:12px;"><div style="font-weight:700;margin-bottom:8px;">Your answer sheet</div>';
    if (STU.urls && STU.urls.length) {
      STU.urls.forEach(function (u, i) {
        if (!u) { return; }
        html += '<div style="position:relative;margin-bottom:10px;background:#fff;max-width:640px;"><img src="' + h(u) + '" draggable="false" style="display:block;width:100%;height:auto;">' +
          (L && d.mode !== 'score' ? overlaySVG(L.pages[i], marks, true) : '') + '</div>';
      });
    } else { html += '<div style="font-size:12.5px;color:var(--text-muted);">The scan of your sheet isn\u2019t available.</div>'; }
    html += '</div>';
    if (d.mode !== 'score') {
      html += '<div class="card" style="margin-bottom:12px;"><div style="font-weight:700;margin-bottom:8px;">Question by question</div>';
      items.forEach(function (it) {
        var reqs = reqByQ[String(it.q)] || [], open = reqs.filter(function (q) { return q.status === 'open'; })[0];
        html += '<div style="border-top:1px solid var(--border);padding:10px 0;">' +
          '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><b>Q' + it.q + '</b>' +
          '<span class="tag ' + (it.correct_flag ? 'green' : 'rose') + '">' + h(it.earned) + ' / ' + h(it.points) + '</span>' +
          '<span style="font-size:13px;">Your answer: <b>' + h(it.your || '(blank)') + '</b> \u00b7 Correct: <b>' + h(it.correct) + '</b></span>' +
          (it.edited ? '<span class="tag amber">adjusted by instructor</span>' : '') + '<div style="flex:1"></div>' +
          (d.can_regrade && !open ? '<button class="btn btn-ghost btn-sm" data-swask="' + it.q + '">Request regrade</button>' : '') + '</div>';
        if (d.mode === 'questions' && it.prompt) {
          html += '<div style="margin:8px 0 0;font-size:14px;">' + h(it.prompt) + '</div>';
          if (it.figure && typeof renderFigure === 'function') { html += renderFigure(it.figure); }
          if (it.options) {
            html += '<ol style="list-style:none;margin:6px 0 0 14px;padding:0;">' + it.options.map(function (o, i) {
              var mark = (i === it.ci ? ' \u2713' : '') + (i === it.yi && i !== it.ci ? ' \u2190 your answer' : '');
              return '<li style="margin:2px 0;' + (i === it.ci ? 'font-weight:700;' : '') + '">' + letter(i) + '. ' + h(o) + '<span style="color:var(--text-muted);font-weight:400;">' + mark + '</span></li>';
            }).join('') + '</ol>';
          }
        }
        reqs.forEach(function (q) {
          html += '<div style="font-size:12.5px;margin-top:6px;padding:6px 10px;border-left:3px solid var(--border-strong);">Your request <span class="tag ' + (REQ_TAG[q.status] || 'dim') + '">' + h(q.status) + '</span>: \u201c' + h(q.reason) + '\u201d' +
            (q.reply ? '<div style="margin-top:3px;">Instructor: ' + h(q.reply) + '</div>' : '') +
            (q.status === 'open' ? ' <button class="btn btn-ghost btn-sm" data-swwd="' + h(q.id) + '">Withdraw</button>' : '') + '</div>';
        });
        html += '<div id="swAsk' + it.q + '"></div></div>';
      });
      html += '</div>';
    }
    html += '<div class="msg" id="swStuMsg" style="display:none;"></div></div>';
    host.innerHTML = html;
    el('swStuBack').addEventListener('click', backToExams);
    Array.prototype.forEach.call(host.querySelectorAll('[data-swask]'), function (b) {
      b.addEventListener('click', function () { askRegrade(b.getAttribute('data-swask')); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-swwd]'), function (b) {
      b.addEventListener('click', function () {
        sb.rpc('im_paper_withdraw_regrade', { p_id: b.getAttribute('data-swwd') }).then(function (r) {
          if (r.error) { say('swStuMsg', r.error.message, 'err'); return; }
          reloadStudentReview('Request withdrawn.');
        });
      });
    });
    protect(d);
  }
  function askRegrade(q) {
    var box = el('swAsk' + q); if (!box) { return; }
    box.innerHTML = '<div style="margin-top:8px;"><textarea id="swAskTxt" rows="3" maxlength="1000" style="width:100%;" placeholder="What should be checked? e.g. I filled B but it was read as blank."></textarea>' +
      '<div class="inline-actions" style="margin-top:6px;"><button class="btn btn-primary btn-sm" id="swAskGo">Send request</button><button class="btn btn-ghost btn-sm" id="swAskNo">Cancel</button></div></div>';
    el('swAskNo').addEventListener('click', function () { box.innerHTML = ''; });
    el('swAskGo').addEventListener('click', function () {
      var t = el('swAskTxt').value.trim();
      if (t.length < 5) { say('swStuMsg', 'Please explain the problem in a few words.', 'err'); return; }
      el('swAskGo').disabled = true;
      sb.rpc('im_paper_request_regrade', { p_sheet: STU.d.sheet_id, p_q: String(q), p_reason: t }).then(function (r) {
        if (r.error) { el('swAskGo').disabled = false; say('swStuMsg', r.error.message, 'err'); return; }
        reloadStudentReview('Request sent. You\u2019ll see the reply here.');
      });
    });
  }
  function reloadStudentReview(msg) {
    sb.rpc('im_paper_my_review', { p_sheet: STU.d.sheet_id }).then(function (r) {
      if (!r.error) { STU.d = r.data; }
      renderStudentReview(); if (msg) { say('swStuMsg', msg, 'ok'); }
    });
  }

  /* -------- protected viewer: discourages copying and makes leaks traceable.
     It cannot stop a phone photo; the watermark ties any copy to one student. */
  var PROT = null;
  function protect(d) {
    unprotect();
    var root = el('swStuReview'); if (!root) { return; }
    var strict = d.mode === 'questions';
    if (d.watermark !== false) {
      var stamp = (d.email || '') + ' \u00b7 ' + new Date().toLocaleString();
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200"><text x="10" y="120" transform="rotate(-24 180 100)" font-family="Helvetica,Arial" font-size="15" fill="#888" fill-opacity="0.22">' + h(stamp) + '</text></svg>';
      var wm = document.createElement('div');
      wm.setAttribute('aria-hidden', 'true');
      wm.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;background-repeat:repeat;background-image:url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")';
      root.appendChild(wm);
    }
    if (!strict) { PROT = { handlers: [] }; return; }
    root.style.userSelect = 'none'; root.style.webkitUserSelect = 'none';
    var style = document.createElement('style'); style.id = 'swProtectCss';
    style.textContent = '@media print{#swStuReview{display:none!important}} #swStuReview.sw-blur{filter:blur(14px)}';
    document.head.appendChild(style);
    var hs = [];
    function on(t, ev, fn) { t.addEventListener(ev, fn, true); hs.push([t, ev, fn]); }
    function block(e) { e.preventDefault(); return false; }
    on(root, 'copy', block); on(root, 'cut', block); on(root, 'contextmenu', block); on(root, 'dragstart', block);
    on(document, 'keydown', function (e) {
      var k = (e.key || '').toLowerCase();
      if ((e.metaKey || e.ctrlKey) && (k === 'c' || k === 'p' || k === 's' || k === 'a')) { e.preventDefault(); }
      if (k === 'printscreen') { root.classList.add('sw-blur'); }
    });
    on(window, 'blur', function () { root.classList.add('sw-blur'); });
    on(window, 'focus', function () { root.classList.remove('sw-blur'); });
    on(document, 'visibilitychange', function () { if (document.hidden) { root.classList.add('sw-blur'); } else { root.classList.remove('sw-blur'); } });
    PROT = { handlers: hs };
  }
  function unprotect() {
    if (PROT && PROT.handlers) { PROT.handlers.forEach(function (x) { x[0].removeEventListener(x[1], x[2], true); }); }
    var st = document.getElementById('swProtectCss'); if (st && st.parentNode) { st.parentNode.removeChild(st); }
    PROT = null;
  }

  window.SWPortal = { open: open, studentSection: studentSection, BUILD: SW_BUILD, _state: function () { return S; }, _makePerm: makePerm };
  try { console.log('%c[Sheetwise] ' + SW_BUILD + ' + ' + (window.SheetwiseCore ? SheetwiseCore.VERSION : 'core missing'), 'color:#7c6df2'); } catch (e) {}
})();
