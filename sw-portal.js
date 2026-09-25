/* ==========================================================================
   Sheetwise for the Intro Micro portal  —  bubble-sheet paper exams.
   Adapter between SheetwiseCore (layout / print / optical reading) and this
   portal's data: im_exam, im_assessment_item, IMGenerators, im_paper_sheet
   (im_77) and im_manual_exam_score (im_71, which feeds the gradebook).

   Uses portal globals: sb, State, $, esc, renderFigure, IMGenerators,
   IMDiagrams, loadExams.  Safari-safe ES5.
   ========================================================================== */
(function () {
  'use strict';
  var SW_BUILD = 'sw-portal-1.0';
  var CDN = {
    jsqr: 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
    pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
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
  function ensureScanLibs() {
    var p = [];
    if (typeof window.jsQR !== 'function') { p.push(loadScript(CDN.jsqr)); }
    if (!window.pdfjsLib) { p.push(loadScript(CDN.pdf).then(function () { if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker; } })); }
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
  function shuffle(arr) { for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
  function chunk(arr, n) { var o = []; for (var i = 0; i < arr.length; i += n) { o.push(arr.slice(i, i + n)); } return o; }
  function say(id, text, kind) { var m = el(id); if (!m) { return; } m.style.display = text ? 'block' : 'none'; m.className = 'msg' + (kind ? ' ' + kind : ''); m.textContent = text || ''; }
  function stripLetter(o) { return String(o == null ? '' : o).replace(/^[A-Z][\).]\s*/, ''); }
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
    if (!item.generator_id || typeof IMGenerators === 'undefined') { return null; }
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
  function questionsForLayout(items) {
    return items.map(function (it) { return { n: it.q, kind: it.kind, nopts: it.nopts }; });
  }
  function layoutFor(sheet) {
    if (!sheet._layout) { sheet._layout = SheetwiseCore.layout(questionsForLayout(sheet.items)); }
    return sheet._layout;
  }

  /* ------------------------------------------------------------- open */
  function open(examId, title) {
    if (typeof SheetwiseCore === 'undefined') { alert('Sheetwise engine (sheetwise-core.js) did not load. Hard-refresh the page.'); return; }
    if (!State || !State.teachCourseId) { alert('Select a course first.'); return; }
    S = { examId: examId, title: title || 'Paper exam', courseId: State.teachCourseId, tab: 'setup',
      sheets: [], roster: [], rosterById: {}, sources: [], scan: null, keys: {} };
    var ov = document.createElement('div'); ov.className = 'modal-bg'; ov.id = 'swOverlay';
    ov.innerHTML = '<div class="modal" style="max-width:1020px;">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;"><h3 style="margin:0;flex:1;">Bubble sheets — ' + h(S.title) + '</h3>' +
      '<button class="btn btn-ghost btn-sm" id="swClose">Close</button></div>' +
      '<div class="inline-actions" id="swTabs" style="margin:10px 0 16px;">' +
      '<button class="btn btn-sm" data-swtab="setup">1 · Questions &amp; printing</button>' +
      '<button class="btn btn-sm" data-swtab="scan">2 · Scan &amp; grade</button>' +
      '<button class="btn btn-sm" data-swtab="results">3 · Results</button></div>' +
      '<div id="swBody"></div></div>';
    document.body.appendChild(ov);
    el('swClose').addEventListener('click', close);
    Array.prototype.forEach.call(ov.querySelectorAll('[data-swtab]'), function (b) {
      b.addEventListener('click', function () { show(b.getAttribute('data-swtab')); });
    });
    el('swBody').innerHTML = (typeof loadingCard === 'function') ? loadingCard() : 'Loading…';
    loadBase().then(function () { show('setup'); }, function (err) {
      el('swBody').innerHTML = '<div class="msg err" style="display:block;">' + h(err && err.message ? err.message : String(err)) + '</div>';
    });
  }
  function close() {
    if (S && S.scan && S.scan.busy && !confirm('A scan is still being read. Close anyway?')) { return; }
    var ov = el('swOverlay'); if (ov && ov.parentNode) { ov.parentNode.removeChild(ov); }
    S = null;
    if (typeof loadExams === 'function') { try { loadExams(); } catch (e) {} }
  }
  function show(tab) {
    S.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('#swTabs [data-swtab]'), function (b) {
      var on = b.getAttribute('data-swtab') === tab;
      b.className = 'btn btn-sm ' + (on ? 'btn-primary' : 'btn-ghost');
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
      if (r[0].error) { throw new Error(/relation|does not exist|schema cache/i.test(r[0].error.message) ? 'Bubble sheets aren’t installed yet. Run im_77_paper_sheets.sql in the Supabase SQL editor, then reopen.' : r[0].error.message); }
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
    var opts = S.sources.map(function (e) {
      var n = e.random_per_student ? (e.random_recipe || []).reduce(function (a, r) { return a + (Number(r.n) || 0); }, 0) : (e.item_ids || []).length;
      return '<option value="' + h(e.id) + '">' + h(e.title) + ' — ' + n + ' questions' + (e.random_per_student ? ' (fresh draw per student)' : '') + '</option>';
    }).join('');
    var html = '';
    html += '<div class="card" style="margin-bottom:14px;">' +
      '<div style="font-weight:700;margin-bottom:4px;">' + (live.length ? live.length + ' sheets issued' : 'No sheets issued yet') + '</div>' +
      '<div style="font-size:12.5px;color:var(--text-muted);">' + (live.length ? (live.length - spares) + ' named · ' + spares + ' spare · ' + graded + ' graded' : 'Pick where the questions come from, then issue one sheet per student.') + '</div></div>';

    html += '<div class="card" style="margin-bottom:14px;">' +
      '<div style="font-weight:700;margin-bottom:10px;">Issue sheets</div>' +
      (S.sources.length ? '' : '<div class="msg err" style="display:block;margin-bottom:10px;">No question source yet. Use “Assemble exam” to build the questions (leave it unpublished so students can’t take it online), then come back here.</div>') +
      '<label class="fld">Questions come from<select id="swSrc">' + opts + '</select></label>' +
      '<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:6px 0;"><input type="checkbox" id="swPerStudent" checked> <span><b>Different numbers for every student</b> — each sheet gets its own seed, so neighbours’ answers don’t match. Answer options are reshuffled too.</span></label>' +
      '<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:6px 0;"><input type="checkbox" id="swShuffleQ"> <span>Shuffle question order per student</span></label>' +
      '<label class="fld" style="max-width:220px;">Spare (unnamed) sheets<input type="number" id="swSpares" min="0" max="60" value="6"></label>' +
      '<div style="font-size:12px;color:var(--text-subtle);margin:4px 0 10px;">Written (free-response) questions are left off the bubble sheet in this version. Students with a graded sheet keep it; everyone else gets a fresh sheet.</div>' +
      '<div class="inline-actions"><button class="btn btn-primary btn-sm" id="swIssue"' + (S.sources.length ? '' : ' disabled') + '>' + (live.length ? 'Re-issue sheets' : 'Issue sheets') + ' for ' + S.roster.length + ' students</button></div>' +
      '<div class="msg" id="swIssueMsg" style="display:none;margin-top:10px;"></div></div>';

    html += '<div class="card"><div style="font-weight:700;margin-bottom:10px;">Print</div>' +
      '<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px;">Each student gets their own question booklet followed by their answer sheet (name and code printed on both). Any printer and any scale work — photocopies are fine. Print from Chrome for best results.</div>' +
      '<div class="inline-actions" style="flex-wrap:wrap;gap:8px;">' +
      '<select id="swBatch" style="max-width:260px;"></select>' +
      '<label style="font-size:13px;display:flex;gap:6px;align-items:center;"><input type="checkbox" id="swSheetsOnly"> Answer sheets only</label>' +
      '<button class="btn btn-primary btn-sm" id="swPrint"' + (live.length ? '' : ' disabled') + '>Open print view</button>' +
      '<button class="btn btn-ghost btn-sm" id="swKey"' + (live.length ? '' : ' disabled') + '>Download answer key (CSV)</button></div>' +
      '<div class="msg" id="swPrintMsg" style="display:none;margin-top:10px;"></div></div>';
    el('swBody').innerHTML = html;

    var batches = chunk(printOrder(), 40);
    el('swBatch').innerHTML = batches.length ? batches.map(function (b, i) {
      return '<option value="' + i + '">Sheets ' + (i * 40 + 1) + '–' + (i * 40 + b.length) + ' (' + h(b[0].student_label || '') + ' … ' + h(b[b.length - 1].student_label || '') + ')</option>';
    }).join('') + (batches.length > 1 ? '<option value="all">All ' + live.length + ' sheets</option>' : '') : '<option>—</option>';
    el('swIssue').addEventListener('click', issueSheets);
    el('swPrint').addEventListener('click', function () {
      var v = el('swBatch').value;
      var list = v === 'all' ? printOrder() : (batches[Number(v)] || []);
      openPrint(list, el('swSheetsOnly').checked);
    });
    el('swKey').addEventListener('click', downloadKey);
  }

  function printOrder() {
    var named = [], spare = [];
    S.sheets.forEach(function (s) { if (s.status === 'void') { return; } (s.student_id ? named : spare).push(s); });
    named.sort(function (a, b) { var x = (a.student_label || '').toLowerCase(), y = (b.student_label || '').toLowerCase(); return x < y ? -1 : (x > y ? 1 : 0); });
    return named.concat(spare);
  }

  // Load item rows for a set of ids.
  function fetchItems(ids) {
    var out = {};
    return runSeq(chunk(ids, 150), function (part) {
      return sb.from('im_assessment_item').select('*').in('id', part).then(function (r) {
        if (r.error) { throw new Error('Could not read the question bank: ' + r.error.message); }
        (r.data || []).forEach(function (it) { out[String(it.id)] = it; });
      });
    }).then(function () { return out; });
  }
  // For fresh-per-student exams: fetch each recipe slot's pool once.
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

  // Build one sheet's item list. Returns { items, skipped }.
  function buildItems(itemRows, seedFor, shuffleQ) {
    var list = [], skipped = 0;
    itemRows.forEach(function (it, idx) {
      var seed = seedFor(idx);
      var gen = genFor(it, seed);
      var kind = kindOf(gen, it);
      if (kind === 'short') { skipped++; return; }
      var nopts = 0;
      if (kind === 'mc') { nopts = ((gen && gen.options) || it.options || []).length || 4; }
      if (kind === 'yn') { nopts = 2; }
      list.push({ item_id: it.id, generator_id: it.generator_id || null, seed: seed, kind: kind, nopts: nopts,
        points: Number(it.points) || (gen && gen.points) || 1 });
    });
    if (shuffleQ) { shuffle(list); }
    list.forEach(function (x, i) { x.q = i + 1; });
    return { items: list, skipped: skipped };
  }

  function issueSheets() {
    var src = null, srcId = el('swSrc').value;
    S.sources.forEach(function (e) { if (String(e.id) === String(srcId)) { src = e; } });
    if (!src) { say('swIssueMsg', 'Pick a question source.', 'err'); return; }
    var perStudent = el('swPerStudent').checked, shuffleQ = el('swShuffleQ').checked;
    var spares = Math.max(0, Math.min(60, parseInt(el('swSpares').value, 10) || 0));
    var gradedFor = {};
    S.sheets.forEach(function (s) { if (s.status === 'graded' && s.student_id) { gradedFor[s.student_id] = true; } });
    var targets = S.roster.filter(function (st) { return !gradedFor[st.id]; });
    var toVoid = S.sheets.filter(function (s) { return s.status !== 'graded' && s.status !== 'void'; });
    if (toVoid.length && !confirm('This replaces ' + toVoid.length + ' ungraded sheet(s). Any copies already printed will stop scanning. Continue?')) { return; }
    el('swIssue').disabled = true;
    say('swIssueMsg', 'Building sheets…');

    var sharedSeeds = [];
    var prep;
    if (src.random_per_student) {
      prep = fetchRecipePools(src.random_recipe || []).then(function (pools) { return { pools: pools }; });
    } else {
      prep = fetchItems((src.item_ids || []).map(String)).then(function (map) {
        var rows = (src.item_ids || []).map(function (id) { return map[String(id)]; }).filter(Boolean);
        if (!rows.length) { throw new Error('That exam’s questions could not be read.'); }
        return { rows: rows };
      });
    }
    prep.then(function (P) {
      function rowsForStudent() {
        if (P.rows) { return P.rows; }
        var chosen = [];
        P.pools.forEach(function (sl) { var pool = shuffle(sl.pool.slice()); for (var k = 0; k < Math.min(sl.n, pool.length); k++) { chosen.push(pool[k]); } });
        return chosen;
      }
      function seedFor(i) { if (perStudent) { return randSeed(); } if (!sharedSeeds[i]) { sharedSeeds[i] = randSeed(); } return sharedSeeds[i]; }
      var rows = [], skipped = 0, maxPts = null, ptsVary = false;
      var people = targets.map(function (st) { return { id: st.id, label: st.name }; });
      for (var i = 1; i <= spares; i++) { people.push({ id: null, label: 'Spare ' + i }); }
      people.forEach(function (p) {
        var b = buildItems(rowsForStudent(), seedFor, shuffleQ);
        skipped = Math.max(skipped, b.skipped);
        var pts = b.items.reduce(function (a, x) { return a + x.points; }, 0);
        if (maxPts === null) { maxPts = pts; } else if (pts !== maxPts) { ptsVary = true; maxPts = Math.max(maxPts, pts); }
        var L = SheetwiseCore.layout(questionsForLayout(b.items));
        rows.push({ code: newCode(), exam_id: S.examId, course_id: S.courseId, student_id: p.id, student_label: p.label,
          items: b.items, page_count: L.pageCount, layout_version: SheetwiseCore.VERSION, status: 'printed' });
      });
      if (!rows.length) { throw new Error('Everyone already has a graded sheet.'); }
      if (!rows[0].items.length) { throw new Error('None of the questions can go on a bubble sheet (all written).'); }
      var voidIds = toVoid.map(function (s) { return s.id; });
      return runSeq(chunk(voidIds, 100), function (part) {
        return sb.from('im_paper_sheet').update({ status: 'void' }).in('id', part).then(function (r) { if (r.error) { throw new Error(r.error.message); } });
      }).then(function () {
        return runSeq(chunk(rows, 50), function (part) {
          return sb.from('im_paper_sheet').insert(part).then(function (r) { if (r.error) { throw new Error(r.error.message); } });
        });
      }).then(function () {
        var patch = null;
        if (maxPts && Number(S.exam && S.exam.total_points) !== maxPts) { patch = { total_points: maxPts }; }
        return (patch ? sb.from('im_exam').update(patch).eq('id', S.examId) : Promise.resolve({})).then(function () {
          return { n: rows.length, skipped: skipped, pts: maxPts, ptsVary: ptsVary, patched: !!patch };
        });
      });
    }).then(function (res) {
      return loadBase().then(function () {
        renderSetup();
        say('swIssueMsg', 'Issued ' + res.n + ' sheets · ' + res.pts + ' points each' + (res.patched ? ' (exam total updated)' : '') + '.' +
          (res.skipped ? ' ' + res.skipped + ' written question(s) were left off.' : '') +
          (res.ptsVary ? ' Warning: point totals differ between students — check the recipe.' : ''), res.ptsVary ? 'err' : 'ok');
      });
    }).catch(function (err) {
      el('swIssue').disabled = false;
      say('swIssueMsg', err && err.message ? err.message : String(err), 'err');
    });
  }

  /* ---------------------------------------------------------- printing */
  function openPrint(list, sheetsOnly) {
    if (!list.length) { return; }
    var w = window.open('', '_blank');
    if (!w) { say('swPrintMsg', 'The print window was blocked. Allow pop-ups for this site and try again.', 'err'); return; }
    say('swPrintMsg', 'Building ' + list.length + ' sheets…');
    var needItems = {};
    list.forEach(function (s) { (s.items || []).forEach(function (it) { needItems[String(it.item_id)] = true; }); });
    fetchItems(Object.keys(needItems)).then(function (itemMap) {
      var css = '';
      Array.prototype.forEach.call(document.querySelectorAll('style'), function (st) { css += st.textContent + '\n'; });
      var parts = [];
      parts.push('<!doctype html><html><head><meta charset="utf-8"><title>' + h(S.title) + ' — print</title><style>' + css + '</style><style>' + PRINT_CSS + '</style></head><body class="sw-print">');
      parts.push('<div class="sw-noprint"><b>' + list.length + ' students</b> · print double-sided off, US Letter. <button onclick="window.print()">Print</button></div>');
      list.forEach(function (sheet) {
        if (!sheetsOnly) { parts.push(bookletHTML(sheet, itemMap)); }
        var L = layoutFor(sheet);
        for (var p = 0; p < L.pages.length; p++) {
          parts.push('<div class="sw-sheet">' + SheetwiseCore.renderPageSVG(L.pages[p], {
            title: S.title, studentName: sheet.student_label && sheet.student_id ? sheet.student_label : '',
            studentLine2: sheet.student_id ? '' : (sheet.student_label || 'Spare') + ' — write your name',
            code: sheet.code, pageCount: L.pageCount }) + '</div>');
        }
      });
      parts.push('</body></html>');
      w.document.open(); w.document.write(parts.join('')); w.document.close();
      say('swPrintMsg', 'Print view opened in a new tab.', 'ok');
    }).catch(function (err) { say('swPrintMsg', err.message || String(err), 'err'); try { w.close(); } catch (e) {} });
  }

  var PRINT_CSS = '@page{size:letter;margin:0.4in}' +
    'body.sw-print{background:#fff!important;color:#000!important;font-family:Georgia,"Times New Roman",serif;margin:0}' +
    '.sw-noprint{font-family:Helvetica,Arial,sans-serif;padding:10px;background:#fffbe6;border-bottom:1px solid #ccc}' +
    '@media print{.sw-noprint{display:none}}' +
    '.sw-sheet{page-break-before:always;break-before:page}' +
    '.sw-sheet svg{width:7.7in!important;height:auto!important;display:block;margin:0 auto}' +
    '.sw-book{page-break-before:always;break-before:page;font-size:11.5pt;line-height:1.4;color:#000}' +
    '.sw-book h1{font-size:15pt;margin:0 0 2px;color:#000}.sw-book .sub{font-size:9.5pt;color:#333;margin-bottom:10px;font-family:Helvetica,Arial,sans-serif}' +
    '.sw-q{break-inside:avoid;page-break-inside:avoid;margin:0 0 14px}.sw-q .n{font-weight:700}' +
    '.sw-q ol{list-style:none;margin:4px 0 0 18px;padding:0}.sw-q li{margin:2px 0}' +
    '.sw-q .hint{font-family:Helvetica,Arial,sans-serif;font-size:9pt;color:#444}' +
    '.sw-book .fig-svg{max-width:3.3in!important;margin:6px 0 6px 18px!important}.sw-book .fig-svg svg{width:100%!important;height:auto!important;max-height:2.6in}.sw-book *{color:#000}' +
    '.sw-book .pm-table td,.sw-book .pm-table th{border:1px solid #444!important;background:#fff!important;padding:3px 8px}';

  function bookletHTML(sheet, itemMap) {
    var b = ['<div class="sw-book"><h1>' + h(S.title) + '</h1><div class="sub">' +
      h(sheet.student_id ? sheet.student_label : 'Spare booklet — write your name on the answer sheet') +
      ' · booklet ' + h(sheet.code) + ' · ' + sheet.items.length + ' questions. Mark every answer on your answer sheet; only the sheet is graded. Your questions are different from your neighbours’.</div>'];
    sheet.items.forEach(function (it) {
      var row = itemMap[String(it.item_id)] || {};
      var gen = genFor(row, it.seed);
      var prompt = gen && gen.prompt ? gen.prompt : (row.prompt || '');
      var fig = figureFor(gen);
      b.push('<div class="sw-q"><span class="n">' + it.q + '.</span> ' + h(prompt));
      if (fig && typeof renderFigure === 'function') { b.push(renderFigure(fig)); }
      if (it.kind === 'mc') {
        var opts = (gen && gen.options) ? gen.options : (row.options || []);
        b.push('<ol>');
        for (var i = 0; i < opts.length; i++) { b.push('<li><b>' + String.fromCharCode(65 + i) + '.</b> ' + h(stripLetter(opts[i])) + '</li>'); }
        b.push('</ol>');
      } else if (it.kind === 'yn') {
        b.push('<div class="hint">Answer on the sheet: Y = yes, N = no.</div>');
      } else {
        b.push('<div class="hint">Numeric answer — write it in the boxes for Q' + it.q + ' and bubble each digit (use − for negatives, . for decimals).</div>');
      }
      b.push('</div>');
    });
    b.push('</div>');
    return b.join('');
  }

  /* ------------------------------------------------------- answer key */
  function correctDisplay(it, row) {
    var gen = genFor(row, it.seed);
    if (!gen) { return '(bank key)'; }
    if (it.kind === 'mc') {
      for (var i = 0; i < (it.nopts || 0); i++) {
        try { var g = IMGenerators.grade(it.generator_id, it.seed, String(i)); if (g && g.correct) { return String.fromCharCode(65 + i); } } catch (e) {}
      }
      return '?';
    }
    if (it.kind === 'yn') {
      try { if (IMGenerators.grade(it.generator_id, it.seed, 'yes').correct) { return 'Y'; } return 'N'; } catch (e2) { return '?'; }
    }
    return gen.answer != null ? String(gen.answer) : '?';
  }
  function downloadKey() {
    var list = printOrder(), need = {};
    list.forEach(function (s) { s.items.forEach(function (it) { need[String(it.item_id)] = true; }); });
    fetchItems(Object.keys(need)).then(function (map) {
      var lines = ['code,student,question,correct,points,item_id'];
      list.forEach(function (s) {
        s.items.forEach(function (it) {
          lines.push([s.code, csv(s.student_label), it.q, csv(correctDisplay(it, map[String(it.item_id)] || {})), it.points, it.item_id].join(','));
        });
      });
      saveText(lines.join('\n'), (S.title || 'exam').replace(/[^a-z0-9]+/gi, '_') + '_answer_key.csv');
    }).catch(function (err) { say('swPrintMsg', err.message || String(err), 'err'); });
  }
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
    var L = layoutFor(s); return L.pages[(pageNo || 1) - 1] || null;
  }

  function renderScan() {
    if (!S.scan) { S.scan = { pages: [], busy: false, done: 0, total: 0 }; }
    var html = '<div class="card" style="margin-bottom:14px;">' +
      '<div style="font-weight:700;margin-bottom:6px;">Add scans</div>' +
      '<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px;">Drop the PDF(s) from the copier or scanner here — whole stacks are fine, in any order, either way up. Booklet pages are skipped automatically. Everything is read in this browser; nothing is uploaded except the final answers.</div>' +
      '<div id="swDrop" style="border:2px dashed var(--border-strong);border-radius:12px;padding:22px;text-align:center;cursor:pointer;">' +
      '<b>Drop PDFs or images</b> or click to choose<input type="file" id="swFile" accept="application/pdf,image/*" multiple style="display:none"></div>' +
      '<div id="swProg" style="margin-top:10px;font-size:13px;"></div></div>' +
      '<div id="swScanSummary"></div><div id="swReview"></div>';
    el('swBody').innerHTML = html;
    var drop = el('swDrop'), inp = el('swFile');
    drop.addEventListener('click', function () { inp.click(); });
    inp.addEventListener('change', function () { if (inp.files && inp.files.length) { ingest(inp.files); } inp.value = ''; });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.style.background = 'rgba(124,109,242,.12)'; });
    drop.addEventListener('dragleave', function () { drop.style.background = ''; });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.style.background = ''; if (e.dataTransfer && e.dataTransfer.files.length) { ingest(e.dataTransfer.files); } });
    renderScanState();
  }

  function ingest(fileList) {
    if (S.scan.busy) { return; }
    var files = Array.prototype.slice.call(fileList);   // copy: the input is cleared right after
    if (!S.sheets.length) { el('swProg').textContent = 'Issue sheets first (tab 1).'; return; }
    S.scan.busy = true;
    el('swProg').innerHTML = '<span class="spinner"></span> Loading reader…';
    ensureScanLibs().then(function () {
      return SheetwiseCore.loadFiles(files, function (cv, n, total, name) {
        el('swProg').innerHTML = '<span class="spinner"></span> Reading page ' + n + (total ? ' of ' + total : '') + '…';
        return new Promise(function (res) {
          setTimeout(function () {
            var out;
            try { out = SheetwiseCore.readCanvas(cv, resolvePage); } catch (e) { out = { ok: false, error: 'Read error: ' + e.message }; }
            out.source = name;
            if (!out.ok) { out.thumb = thumb(cv); }
            S.scan.pages.push(out);
            res();
          }, 0);
        });
      });
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
  function thumb(cv) {
    var t = document.createElement('canvas'), s = 260 / cv.width; t.width = 260; t.height = Math.round(cv.height * s);
    t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height); return t.toDataURL('image/jpeg', 0.6);
  }

  // Combine page reads into per-sheet answer sets.
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
      e.sheet.items.forEach(function (it) { var a = e.answers[it.q]; if (a && a.needsReview && !a.resolved) { e.review.push(a); } });
    });
    return { sheets: list, orphans: orphans, skipped: skipped };
  }

  function renderScanState() {
    var C = collate(); S.scan.collated = C;
    var nReview = 0, nMissing = 0, nSpareUnassigned = 0;
    C.sheets.forEach(function (e) { nReview += e.review.length; if (e.missingPages.length) { nMissing++; } if (!e.sheet.student_id && !e.assignTo) { nSpareUnassigned++; } });
    var sum = el('swScanSummary'); if (!sum) { return; }
    if (!S.scan.pages.length) { sum.innerHTML = ''; el('swReview').innerHTML = ''; return; }
    var blockers = nReview + nMissing + nSpareUnassigned + C.orphans.length;
    sum.innerHTML = '<div class="card" style="margin-bottom:14px;display:flex;gap:18px;flex-wrap:wrap;align-items:center;">' +
      stat(C.sheets.length, 'answer sheets read') + stat(nReview, 'marks to check', nReview) + stat(C.orphans.length, 'pages need a code', C.orphans.length) +
      stat(nMissing, 'sheets missing a page', nMissing) + stat(nSpareUnassigned, 'spares to assign', nSpareUnassigned) + stat(C.skipped.length, 'pages skipped') +
      '<div style="flex:1"></div><button class="btn btn-primary" id="swGrade"' + (C.sheets.length ? '' : ' disabled') + '>Grade &amp; save ' + C.sheets.length + ' sheet' + (C.sheets.length === 1 ? '' : 's') + '</button>' +
      '<div class="msg" id="swGradeMsg" style="display:none;width:100%;"></div></div>';
    el('swGrade').addEventListener('click', function () {
      if (blockers && !confirm('There are still ' + blockers + ' item(s) to resolve. Unresolved marks and questions on unscanned pages will be graded as blank; spare sheets with no student chosen will be skipped. Continue?')) { return; }
      gradeAndSave(C);
    });
    var rv = [];
    // orphans: pages with unreadable/foreign codes
    C.orphans.forEach(function (p) {
      rv.push('<div class="card" style="margin-bottom:10px;display:flex;gap:14px;align-items:flex-start;"><img src="' + p.preview + '" style="width:190px;border:1px solid var(--border);border-radius:6px;background:#fff">' +
        '<div style="flex:1"><div style="font-weight:700;margin-bottom:4px;">Page needs its sheet code</div><div style="font-size:12.5px;color:var(--text-muted);margin-bottom:8px;">' + h(p.warning || '') + ' (' + h(p.source || '') + ')</div>' +
        '<input type="text" data-orphan="' + p._idx + '" placeholder="7-letter code under the QR" style="width:170px;text-transform:uppercase"> ' +
        '<select data-orphanpg="' + p._idx + '" style="width:90px"><option value="1">page 1</option><option value="2">page 2</option><option value="3">page 3</option></select> ' +
        '<button class="btn btn-ghost btn-sm" data-orphango="' + p._idx + '">Read</button> <button class="btn btn-ghost btn-sm" data-orphandrop="' + p._idx + '">Ignore page</button></div></div>');
    });
    C.sheets.forEach(function (e) {
      var s = e.sheet, head = '<b>' + h(s.student_label || '') + '</b> <span class="tag dim">' + h(s.code) + '</span>';
      if (!s.student_id) {
        rv.push('<div class="card" style="margin-bottom:10px;"><div style="margin-bottom:8px;">' + head + ' — spare sheet: who wrote it?</div>' +
          '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;"><img src="' + (e.pages[1] ? e.pages[1].preview : '') + '" style="width:300px;border:1px solid var(--border);border-radius:6px;background:#fff;object-fit:cover;object-position:top;height:120px">' +
          '<select data-assign="' + h(s.code) + '" style="min-width:240px;"><option value="">— choose student —</option>' + S.roster.map(function (st) {
            return '<option value="' + h(st.id) + '"' + (e.assignTo === st.id ? ' selected' : '') + '>' + h(st.name) + (st.email ? ' · ' + h(st.email) : '') + '</option>'; }).join('') + '</select></div></div>');
      }
      if (e.missingPages.length) {
        rv.push('<div class="card" style="margin-bottom:10px;">' + head + ' — <span style="color:var(--danger,#e11d48)">page ' + e.missingPages.join(', ') + ' not scanned yet.</span> Add it, or grade anyway (its questions count as blank).</div>');
      }
      e.review.forEach(function (a) { rv.push(reviewCard(e, a)); });
    });
    var bad = C.skipped.filter(function (p) { return (p.found || 0) >= 2 || (p.error && /orientation|contrast/i.test(p.error)); });
    bad.forEach(function (p) {
      rv.push('<div class="card" style="margin-bottom:10px;display:flex;gap:14px;align-items:flex-start;border-left:4px solid var(--danger,#e11d48);"><img src="' + p.thumb + '" style="width:150px;border:1px solid var(--border);background:#fff">' +
        '<div><div style="font-weight:700;margin-bottom:4px;">This looks like an answer sheet but couldn\u2019t be read</div><div style="font-size:12.5px;color:var(--text-muted);">' + h(p.error || '') + ' (' + h(p.source || '') + '). Re-scan it and drop the file in again.</div></div></div>');
    });
    if (C.skipped.length) {
      rv.push('<details class="card" style="margin-bottom:10px;"><summary style="cursor:pointer;">' + C.skipped.length + ' page(s) skipped as not answer sheets</summary><div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;">' +
        C.skipped.filter(function (p) { return bad.indexOf(p) < 0; }).map(function (p) { return '<div style="width:140px;font-size:11px;"><img src="' + p.thumb + '" style="width:140px;border:1px solid var(--border);background:#fff"><div>' + h(p.source || '') + '</div><div style="color:var(--text-subtle)">' + h(p.error || '') + '</div></div>'; }).join('') + '</div></details>');
    }
    el('swReview').innerHTML = rv.join('') || '<div class="card empty">Nothing needs checking — every mark was clear.</div>';
    wireReview();
  }
  function stat(n, label, warn) { return '<div><div style="font-size:22px;font-weight:800;' + (warn ? 'color:var(--warn,#d97706)' : '') + '">' + n + '</div><div style="font-size:11.5px;color:var(--text-muted)">' + label + '</div></div>'; }

  var STATUS_TXT = { faint: 'Faint mark', multiple: 'More than one bubble filled', unclear: 'Possible erasure', gap: 'Gap between digits', invalid: 'Not a valid number' };
  function reviewCard(e, a) {
    var s = e.sheet, key = h(s.code) + ':' + a.q;
    var ctl;
    if (a.kind === 'num') {
      ctl = '<input type="text" data-fixnum="' + key + '" value="' + h(a.value == null ? '' : a.value) + '" placeholder="number" style="width:120px"> ' +
        '<button class="btn btn-primary btn-sm" data-fixnumgo="' + key + '">Use this</button> <button class="btn btn-ghost btn-sm" data-fix="' + key + '" data-v="">Blank</button>';
    } else {
      ctl = a.labels.map(function (lb, i) {
        var v = a.kind === 'yn' ? (i === 0 ? 'yes' : 'no') : String(i);
        return '<button class="btn btn-sm ' + (String(a.value) === v ? 'btn-primary' : 'btn-ghost') + '" data-fix="' + key + '" data-v="' + v + '" data-d="' + lb + '">' + lb + '</button>';
      }).join(' ') + ' <button class="btn btn-ghost btn-sm" data-fix="' + key + '" data-v="">Blank</button>';
    }
    return '<div class="card" style="margin-bottom:10px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;">' +
      '<img src="' + (a.crop || '') + '" style="max-height:' + (a.kind === 'num' ? 260 : 60) + 'px;max-width:420px;border:1px solid var(--border);border-radius:6px;background:#fff">' +
      '<div style="flex:1;min-width:220px;"><div style="margin-bottom:4px;"><b>' + h(s.student_label || '') + '</b> · Q' + a.q + ' <span class="tag amber">' + h(STATUS_TXT[a.status] || a.status) + '</span></div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Read as: <b>' + h(a.display || '(nothing)') + '</b></div>' + ctl + '</div></div>';
  }
  function findAnswer(key) {
    var parts = key.split(':'), code = parts[0], q = parts[1];
    var C = S.scan.collated;
    for (var i = 0; i < C.sheets.length; i++) { if (C.sheets[i].sheet.code === code) { return C.sheets[i].answers[q]; } }
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
        var inp = box.querySelector('[data-fixnum="' + key + '"]'), v = inp ? inp.value.replace(/\s+/g, '').replace(/−/g, '-') : '';
        if (v !== '' && !/^-?(\d+\.?\d*|\.\d+)$/.test(v)) { inp.style.borderColor = '#e11d48'; return; }
        a.value = v === '' ? null : v; a.display = v; a.resolved = true; a.edited = true; renderScanState();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-assign]'), function (sel) {
      sel.addEventListener('change', function () {
        var code = sel.getAttribute('data-assign');
        S.scan.assign = S.scan.assign || {}; S.scan.assign[code] = sel.value || null;
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
        if (!p._img) { alert('This page’s image is no longer in memory — please re-scan it.'); return; }
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
  function gradeSheet(sheet, answers, itemMap) {
    var score = 0, max = 0, per = [], unknownKey = 0;
    sheet.items.forEach(function (it) {
      var a = answers[it.q] || null, v = a ? a.value : null, ok = false;
      max += it.points;
      if (v != null && v !== '') {
        if (it.generator_id && typeof IMGenerators !== 'undefined') {
          try { var g = IMGenerators.grade(it.generator_id, Number(it.seed), String(v)); ok = !!(g && g.correct); } catch (e) { ok = false; }
        } else {
          var r = gradeStatic(it, S.keys[String(it.item_id)], v, itemMap[String(it.item_id)]);
          ok = r.correct; if (!r.known) { unknownKey++; }
        }
      }
      var earned = ok ? it.points : 0; score += earned;
      per.push({ q: it.q, item_id: it.item_id, answer: v, correct: ok, earned: earned, points: it.points });
    });
    return { score: Math.round(score * 100) / 100, max: max, per: per, unknownKey: unknownKey };
  }

  function gradeAndSave(C) {
    var todo = C.sheets.filter(function (e) {
      if (!e.sheet.student_id && !e.assignTo) { return false; }
      return true;
    });
    if (!todo.length) { say('swGradeMsg', 'Nothing to save — assign the spare sheets to students first.', 'err'); return; }
    // one live sheet per student: a spare assigned to X voids X's own ungraded sheet
    var ids = {};
    todo.forEach(function (e) { e.sheet.items.forEach(function (it) { ids[String(it.item_id)] = true; }); });
    el('swGrade').disabled = true;
    say('swGradeMsg', 'Grading…');
    var itemMap = {};
    fetchItems(Object.keys(ids)).then(function (m) {
      itemMap = m;
      var staticIds = Object.keys(ids).filter(function (id) { return !(m[id] && m[id].generator_id); });
      return loadStaticKeys(staticIds);
    }).then(function () {
      var now = new Date().toISOString(), uid = State.user ? State.user.id : null;
      var sheetUpdates = [], scoreRows = [], unknown = 0;
      todo.forEach(function (e) {
        var g = gradeSheet(e.sheet, e.answers, itemMap);
        unknown += g.unknownKey;
        var sid = e.sheet.student_id || e.assignTo;
        var ans = {};
        e.sheet.items.forEach(function (it) { var a = e.answers[it.q]; ans[it.q] = a ? { value: a.value, status: a.status, edited: !!a.edited } : { value: null, status: 'not_scanned' }; });
        sheetUpdates.push({ sheet: e.sheet, sid: sid, patch: { student_id: sid, answers: ans, per_item: g.per, score: g.score, max_score: g.max, status: 'graded', graded_at: now, graded_by: uid } });
        scoreRows.push({ exam_id: S.examId, student_id: sid, course_id: S.courseId, points: g.score, updated_by: uid, updated_at: now });
      });
      // spares: void the student's own un-graded sheet first (unique live index)
      var voids = [];
      sheetUpdates.forEach(function (u) {
        if (!u.sheet.student_id) {
          S.sheets.forEach(function (s) { if (s.student_id === u.sid && s.id !== u.sheet.id && s.status !== 'void') { voids.push(s.id); } });
        }
      });
      return runSeq(chunk(voids, 100), function (part) {
        return sb.from('im_paper_sheet').update({ status: 'void' }).in('id', part).then(function (r) { if (r.error) { throw new Error(r.error.message); } });
      }).then(function () {
        return runSeq(sheetUpdates, function (u, i) {
          if (i % 10 === 0) { say('swGradeMsg', 'Saving ' + (i + 1) + ' of ' + sheetUpdates.length + '…'); }
          return sb.from('im_paper_sheet').update(u.patch).eq('id', u.sheet.id).then(function (r) { if (r.error) { throw new Error('Sheet ' + u.sheet.code + ': ' + r.error.message); } });
        });
      }).then(function () {
        return runSeq(chunk(scoreRows, 100), function (part) {
          return sb.from('im_manual_exam_score').upsert(part, { onConflict: 'exam_id,student_id' }).then(function (r) { if (r.error) { throw new Error('Gradebook: ' + r.error.message); } });
        });
      }).then(function () { return { n: scoreRows.length, unknown: unknown }; });
    }).then(function (res) {
      return loadBase().then(function () {
        S.scan = null;
        show('results');
        say('swResMsg', 'Saved ' + res.n + ' score' + (res.n === 1 ? '' : 's') + ' to the gradebook.' + (res.unknown ? ' ' + res.unknown + ' answer(s) had no readable bank key and were marked wrong — check the item bank.' : ''), res.unknown ? 'err' : 'ok');
      });
    }).catch(function (err) {
      var b = el('swGrade'); if (b) { b.disabled = false; }
      say('swGradeMsg', err && err.message ? err.message : String(err), 'err');
    });
  }

  /* ======================================================= TAB 3: results */
  function renderResults() {
    var graded = S.sheets.filter(function (s) { return s.status === 'graded'; });
    var html = '<div class="msg" id="swResMsg" style="display:none;margin-bottom:10px;"></div>';
    if (!graded.length) { el('swBody').innerHTML = html + '<div class="card empty">No sheets graded yet.</div>'; return; }
    var sum = 0, max = 0; graded.forEach(function (s) { sum += Number(s.score) || 0; max += Number(s.max_score) || 0; });
    var items = {};
    graded.forEach(function (s) {
      (s.per_item || []).forEach(function (p) {
        var k = String(p.item_id), o = items[k] || (items[k] = { id: k, n: 0, right: 0, blank: 0 });
        o.n++; if (p.correct) { o.right++; } if (p.answer == null) { o.blank++; }
      });
    });
    var itemList = Object.keys(items).map(function (k) { return items[k]; }).sort(function (a, b) { return a.right / a.n - b.right / b.n; });
    html += '<div class="card" style="margin-bottom:14px;display:flex;gap:22px;flex-wrap:wrap;align-items:center;">' +
      stat(graded.length, 'sheets graded') + stat(max ? Math.round(sum / max * 1000) / 10 + '%' : '—', 'class average') +
      '<div style="flex:1"></div><button class="btn btn-ghost btn-sm" id="swRegrade">Re-grade all</button><button class="btn btn-ghost btn-sm" id="swCsv">Download results (CSV)</button></div>';
    html += '<div class="card" style="margin-bottom:14px;"><div style="font-weight:700;margin-bottom:8px;">Hardest questions</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Lowest share correct first. Very low numbers on an easy topic often mean a key or generator problem.</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th>Students</th><th>Correct</th><th>Blank</th></tr></thead><tbody>' +
      itemList.slice(0, 12).map(function (o) {
        var pct = Math.round(o.right / o.n * 100);
        return '<tr><td style="font-family:monospace;font-size:11.5px;">' + h(o.id) + '</td><td>' + o.n + '</td><td>' + pct + '%' + (pct < 25 && o.n >= 5 ? ' <span class="tag rose">check key</span>' : '') + '</td><td>' + o.blank + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    html += '<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Student</th><th>Sheet</th><th>Score</th><th>Hand-checked</th></tr></thead><tbody>' +
      graded.slice().sort(function (a, b) { var x = nameOf(a).toLowerCase(), y = nameOf(b).toLowerCase(); return x < y ? -1 : (x > y ? 1 : 0); }).map(function (s) {
        var ed = 0; if (s.answers) { for (var q in s.answers) { if (s.answers[q] && s.answers[q].edited) { ed++; } } }
        return '<tr><td>' + h(nameOf(s)) + '</td><td><span class="tag dim">' + h(s.code) + '</span></td><td>' + h(s.score) + ' / ' + h(s.max_score) + '</td><td>' + (ed || '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    el('swBody').innerHTML = html;
    el('swCsv').addEventListener('click', function () {
      var lines = ['student,email,sheet,score,max'];
      graded.forEach(function (s) { var st = S.rosterById[s.student_id] || {}; lines.push([csv(nameOf(s)), csv(st.email || ''), s.code, s.score, s.max_score].join(',')); });
      saveText(lines.join('\n'), (S.title || 'exam').replace(/[^a-z0-9]+/gi, '_') + '_results.csv');
    });
    el('swRegrade').addEventListener('click', function () { regradeAll(graded); });
  }
  function nameOf(s) { var st = S.rosterById[s.student_id]; return st ? st.name : (s.student_label || s.student_id || ''); }

  function regradeAll(graded) {
    if (!confirm('Re-grade all ' + graded.length + ' sheets from their saved answers (e.g. after fixing a question)?')) { return; }
    var ids = {}; graded.forEach(function (s) { s.items.forEach(function (it) { ids[String(it.item_id)] = true; }); });
    say('swResMsg', 'Re-grading…');
    var itemMap;
    fetchItems(Object.keys(ids)).then(function (m) {
      itemMap = m; S.keys = {};
      return loadStaticKeys(Object.keys(ids).filter(function (id) { return !(m[id] && m[id].generator_id); }));
    }).then(function () {
      var now = new Date().toISOString(), uid = State.user ? State.user.id : null, changed = 0, rows = [];
      return runSeq(graded, function (s) {
        var g = gradeSheet(s, s.answers || {}, itemMap);
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
      return loadBase().then(function () { renderResults(); say('swResMsg', 'Re-graded. ' + changed + ' score(s) changed.', 'ok'); });
    }).catch(function (err) { say('swResMsg', err.message || String(err), 'err'); });
  }

  window.SWPortal = { open: open, BUILD: SW_BUILD, _state: function () { return S; } };
  try { console.log('%c[Sheetwise] ' + SW_BUILD + ' + ' + (window.SheetwiseCore ? SheetwiseCore.VERSION : 'core missing'), 'color:#7c6df2'); } catch (e) {}
})();
