// scan-render.js - shows a student's OWN graded paper (bubble-sheet) exam: the scanned answer sheet pages beside the list of questions they missed.
// The server sends only storage paths and short strings. The pages are fetched here with the STUDENT'S OWN session (a short-lived signed link from the private
// paper-scans bucket, which only that student, and the course staff, can read), so the AI server never handles the images. Every string is set with textContent.
var PATH = /^[A-Za-z0-9][A-Za-z0-9_\-./]{0,200}$/;
var CSS_ID = 'mnai-scan-css';
var CSS = [
'.mnai-scan{background:#fff;color:#1b2430;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;font:14px/1.4 system-ui,sans-serif;text-align:left}',
'.mnai-scan h4{margin:0;font:700 15px/1.3 system-ui,sans-serif;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.mnai-scan h4 span{font-weight:600;color:#1f5fbf}',
'.mnai-scan-tabs{display:flex;gap:6px;flex-wrap:wrap}.mnai-scan-tabs button{border:1px solid #9aa6b8;background:#fff;color:#1b2430;border-radius:6px;padding:4px 10px;font:600 13px system-ui,sans-serif;cursor:pointer;min-height:30px}',
'.mnai-scan-tabs button[aria-pressed=true]{background:#1f5fbf;color:#fff;border-color:#1f5fbf}',
'.mnai-scan-pg{position:relative;overflow:auto;max-height:70vh;border:1px solid #d5dbe5;border-radius:6px;background:#f4f6f9;min-height:120px}',
'.mnai-scan-pg img{display:block;width:100%;height:auto;cursor:zoom-in}.mnai-scan-pg.zoom img{width:220%;max-width:none;cursor:zoom-out}',
'.mnai-scan-pg .mnai-scan-msg{padding:18px;color:#4a5565}',
'.mnai-scan-hint{font-size:12px;color:#4a5565}',
'.mnai-scan-wrong{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px}',
'.mnai-scan-wrong li{border-left:4px solid #c0392b;background:#fdf1ef;border-radius:4px;padding:5px 9px}.mnai-scan-wrong b{color:#8a1c14}',
'.mnai-scan-ok{color:#1a7f37;font-weight:600}',
'@media (prefers-color-scheme:dark){.mnai-scan-pg{background:#e9edf3}}'
].join('\n');
var fin = function (v) { return typeof v === 'number' && isFinite(v) && Math.abs(v) < 1e6; };
var str = function (v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, n); };

/** Checks a scan spec from the server; returns a clean copy or null. */
export function cleanScan(spec) {
  if (!spec || spec.kind !== 'scan' || spec.bucket !== 'paper-scans' || !Array.isArray(spec.paths)) return null;
  var paths = spec.paths.filter(function (p) { return typeof p === 'string' && PATH.test(p) && p.indexOf('..') < 0; }).slice(0, 12);
  if (!paths.length) return null;
  var wrong = (Array.isArray(spec.wrong) ? spec.wrong : []).slice(0, 60).map(function (w) {
    return { q: str(w && w.q, 8), your: str(w && w.your, 40) || 'blank', correct: w && w.correct != null ? str(w.correct, 40) : null, earned: w && fin(w.earned) ? w.earned : null, points: w && fin(w.points) ? w.points : null };
  });
  return { title: str(spec.title, 120), score: fin(spec.score) ? spec.score : null, max: fin(spec.max_score) ? spec.max_score : null, paths: paths, wrong: wrong, total: fin(spec.total_questions) ? spec.total_questions : null };
}

/**
 * Builds the viewer. `client` is the page's Supabase client (the student's session). Returns the element (with ._revoke()) or null.
 * `onLoad` is called after each page loads, so a scrolling container can re-measure.
 */
export function buildScan(spec, doc, client, onLoad) {
  var s = cleanScan(spec); if (!s || !doc) return null;
  if (!doc.getElementById(CSS_ID)) { var st = doc.createElement('style'); st.id = CSS_ID; st.textContent = CSS; doc.head.appendChild(st); }
  var root = doc.createElement('div'); root.className = 'mnai-scan';
  var h = doc.createElement('h4'); h.appendChild(doc.createTextNode(s.title || 'Your graded exam'));
  if (s.score !== null && s.max !== null) { var sc = doc.createElement('span'); sc.textContent = s.score + ' / ' + s.max; h.appendChild(sc); }
  root.appendChild(h);
  var tabs = doc.createElement('div'); tabs.className = 'mnai-scan-tabs'; tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Pages of your answer sheet');
  var pg = doc.createElement('div'); pg.className = 'mnai-scan-pg';
  var img = doc.createElement('img'); img.alt = 'Your graded answer sheet, page 1'; img.decoding = 'async';
  var msg = doc.createElement('div'); msg.className = 'mnai-scan-msg'; msg.textContent = 'Loading your answer sheet…';
  pg.append(msg);
  var urls = [], cur = -1, alive = true, btns = [];
  function show(i) {
    cur = i; btns.forEach(function (b, k) { b.setAttribute('aria-pressed', k === i ? 'true' : 'false'); });
    pg.classList.remove('zoom');
    function put(u) {
      if (!alive || cur !== i) return;
      if (!u) { pg.textContent = ''; msg.textContent = 'This page could not be loaded. Your graded sheet is also in the Papers section of your portal.'; pg.appendChild(msg); return; }
      img.onload = function () { if (onLoad) onLoad(); };
      img.alt = 'Your graded answer sheet, page ' + (i + 1); img.src = u; pg.textContent = ''; pg.appendChild(img);
    }
    if (urls[i] !== undefined) { put(urls[i]); return; }
    var done = function (u) { urls[i] = u || null; put(urls[i]); };
    try {
      client.storage.from('paper-scans').createSignedUrl(s.paths[i], 900).then(function (r) { done(r && r.data ? r.data.signedUrl : null); }, function () { done(null); });
    } catch (e) { done(null); }
  }
  s.paths.forEach(function (p, i) {
    var b = doc.createElement('button'); b.type = 'button'; b.textContent = 'Page ' + (i + 1); b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', function () { show(i); }); btns.push(b);
  });
  if (s.paths.length > 1) root.appendChild(tabs); btns.forEach(function (b) { tabs.appendChild(b); });
  pg.addEventListener('click', function (e) { if (e.target === img) { pg.classList.toggle('zoom'); if (onLoad) onLoad(); } });
  root.appendChild(pg);
  var hint = doc.createElement('div'); hint.className = 'mnai-scan-hint'; hint.textContent = 'Tap the sheet to zoom in or out.'; root.appendChild(hint);
  var lh = doc.createElement('h4'); root.appendChild(lh);
  if (s.wrong.length) {
    lh.textContent = 'Questions to go over (' + s.wrong.length + ')';
    var ul = doc.createElement('ul'); ul.className = 'mnai-scan-wrong';
    s.wrong.forEach(function (w) {
      var li = doc.createElement('li'), b = doc.createElement('b'); b.textContent = 'Question ' + w.q; li.appendChild(b);
      var t = ' — you chose ' + w.your + (w.correct ? '; the key says ' + w.correct : '') + (w.earned !== null && w.points !== null ? ' (' + w.earned + ' of ' + w.points + ' points)' : '');
      li.appendChild(doc.createTextNode(t)); ul.appendChild(li);
    });
    root.appendChild(ul);
  } else {
    lh.textContent = 'Questions to go over';
    var ok = doc.createElement('div'); ok.className = 'mnai-scan-ok'; ok.textContent = s.total ? 'No missed questions were released for this exam.' : 'The instructor released your score and the scan only.'; root.appendChild(ok);
  }
  root._revoke = function () { alive = false; };
  show(0);
  return root;
}
