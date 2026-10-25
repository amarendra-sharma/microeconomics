// missed-render.js - the questions a student missed on their OWN graded exam, written on the whiteboard one card per question: the question, the answer choices,
// what the student chose, and (only when the instructor allows it) the correct answer and the explanation. Every string comes from the server as short text and is
// set with textContent; nothing is ever inserted as HTML.
var CSS_ID = 'mnai-missed-css';
var CSS = [
'.mnai-missed{background:#fff;color:#1b2430;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;font:14px/1.45 system-ui,sans-serif;text-align:left}',
'.mnai-missed h4{margin:0;font:700 15px/1.3 system-ui,sans-serif;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.mnai-missed h4 span{font-weight:600;color:#1f5fbf}',
'.mnai-missed-sub{font-size:12.5px;color:#4a5565}',
'.mnai-missed-q{border-left:4px solid #c0392b;background:#fdf1ef;border-radius:4px;padding:8px 10px;display:flex;flex-direction:column;gap:5px}',
'.mnai-missed-q b.n{color:#8a1c14}.mnai-missed-p{white-space:pre-wrap;word-wrap:break-word}',
'.mnai-missed-o{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px}',
'.mnai-missed-o li{border:1px solid #d5dbe5;background:#fff;border-radius:5px;padding:3px 8px}',
'.mnai-missed-o li.you{border-color:#c0392b;background:#fbe4e0}.mnai-missed-o li.key{border-color:#1a7f37;background:#e3f4e8}.mnai-missed-o li.you.key{border-color:#1a7f37}',
'.mnai-missed-o li i{font-style:normal;font-size:12px;font-weight:700;margin-left:6px}',
'.mnai-missed-a{font-size:13.5px}.mnai-missed-a .y{color:#8a1c14;font-weight:600}.mnai-missed-a .k{color:#1a7f37;font-weight:600}',
'.mnai-missed-e{font-size:13px;color:#2b3645;border-top:1px dashed #c9d1dc;padding-top:4px;white-space:pre-wrap}',
'@media (prefers-color-scheme:dark){.mnai-missed-q{background:#fdf1ef}}'
].join('\n');
var fin = function (v) { return typeof v === 'number' && isFinite(v) && Math.abs(v) < 1e6; };
var str = function (v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').slice(0, n); };
var norm = function (s) { return String(s || '').trim().toLowerCase(); };


// ---- the question's own graph: an SVG string from the server, rebuilt element by element from a short allow-list (no scripts, links, styles or images) ----
var SVG_NS = 'http://www.w3.org/2000/svg';
var OK_TAGS = { svg: 1, g: 1, line: 1, path: 1, rect: 1, circle: 1, ellipse: 1, polygon: 1, polyline: 1, text: 1, tspan: 1, title: 1, defs: 1, marker: 1 };
var OK_ATTRS = { x: 1, y: 1, x1: 1, x2: 1, y1: 1, y2: 1, cx: 1, cy: 1, r: 1, rx: 1, ry: 1, dx: 1, dy: 1, width: 1, height: 1, points: 1, d: 1, transform: 1, fill: 1, stroke: 1, 'stroke-width': 1, 'stroke-dasharray': 1, 'stroke-linecap': 1, 'stroke-linejoin': 1, opacity: 1, 'fill-opacity': 1, 'stroke-opacity': 1, 'font-family': 1, 'font-size': 1, 'font-weight': 1, 'font-style': 1, 'text-anchor': 1, 'dominant-baseline': 1, id: 1, markerWidth: 1, markerHeight: 1, refX: 1, refY: 1, orient: 1, markerUnits: 1, viewBox: 1 };
function copyNode(src, doc, depth, budget) {
  if (depth > 12 || budget.n++ > 1500) return null;
  if (src.nodeType === 3) return doc.createTextNode(String(src.nodeValue || '').slice(0, 200));
  if (src.nodeType !== 1) return null;
  var tag = String(src.localName || '').toLowerCase();
  if (!OK_TAGS[tag]) return null;
  var out = doc.createElementNS(SVG_NS, tag);
  for (var i = 0; i < src.attributes.length; i++) {
    var a = src.attributes[i], name = a.name;
    if (!OK_ATTRS[name]) continue;
    var v = String(a.value || '');
    if (v.length > 4000 || /url\s*\(|javascript:|expression|<|&#/i.test(v)) { if (name === 'fill' || name === 'stroke') { if (!/^url\(#[\w-]+\)$/.test(v)) continue; } else continue; }
    out.setAttribute(name, v);
  }
  for (var c = src.firstChild; c; c = c.nextSibling) { var k = copyNode(c, doc, depth + 1, budget); if (k) out.appendChild(k); }
  return out;
}
export function safeSvg(text, doc) {
  try {
    if (typeof text !== 'string' || text.length > 30000 || text.indexOf('<svg') !== 0) return null;
    var win = doc.defaultView || window, parsed = new win.DOMParser().parseFromString(text, 'image/svg+xml');
    var root = parsed && parsed.documentElement;
    if (!root || String(root.localName).toLowerCase() !== 'svg' || parsed.getElementsByTagName('parsererror').length) return null;
    var out = copyNode(root, doc, 0, { n: 0 });
    if (!out) return null;
    out.removeAttribute('width'); out.removeAttribute('height');
    out.setAttribute('style', 'width:100%;max-width:430px;height:auto;display:block;background:#fff;border:1px solid #d5dbe5;border-radius:6px');
    out.setAttribute('role', 'img'); out.setAttribute('aria-label', 'Graph for this question');
    return out;
  } catch (e) { return null; }
}

/** Checks a "missed" spec from the server; returns a clean copy or null. */
export function cleanMissed(spec) {
  if (!spec || spec.kind !== 'missed' || !Array.isArray(spec.items) || !spec.items.length) return null;
  var items = spec.items.slice(0, 60).map(function (m) {
    return {
      q: str(m && m.q, 8), figure: m && typeof m.figure === 'string' && m.figure.length <= 30000 ? m.figure : '', prompt: m && m.prompt ? str(m.prompt, 700) : '', your: str(m && m.your, 160) || 'blank',
      options: Array.isArray(m && m.options) ? m.options.slice(0, 8).map(function (o) { return str(o, 160); }) : [],
      correct: m && m.correct != null ? str(m.correct, 160) : '', explanation: m && m.explanation ? str(m.explanation, 700) : '',
      earned: m && fin(m.earned) ? m.earned : null, points: m && fin(m.points) ? m.points : null
    };
  });
  return { title: str(spec.title, 120), score: fin(spec.score) ? spec.score : null, max: fin(spec.max_score) ? spec.max_score : null, total: fin(spec.total_questions) ? spec.total_questions : null, index: fin(spec.index) ? spec.index : null, count: fin(spec.count) ? spec.count : null, items: items };
}

/** Builds the card list. Returns the element or null. */
export function buildMissed(spec, doc) {
  var s = cleanMissed(spec); if (!s || !doc) return null;
  if (!doc.getElementById(CSS_ID)) { var st = doc.createElement('style'); st.id = CSS_ID; st.textContent = CSS; doc.head.appendChild(st); }
  var root = doc.createElement('div'); root.className = 'mnai-missed';
  var h = doc.createElement('h4'); h.appendChild(doc.createTextNode(s.title || 'Your graded exam'));
  if (s.score !== null && s.max !== null) { var sc = doc.createElement('span'); sc.textContent = s.score + ' / ' + s.max; h.appendChild(sc); }
  root.appendChild(h);
  var sub = doc.createElement('div'); sub.className = 'mnai-missed-sub';
  sub.textContent = s.index && s.count ? 'Missed question ' + s.index + ' of ' + s.count : 'Questions to go over: ' + s.items.length + (s.total ? ' of ' + s.total : ''); root.appendChild(sub);
  s.items.forEach(function (m) {
    var card = doc.createElement('div'); card.className = 'mnai-missed-q';
    var n = doc.createElement('b'); n.className = 'n'; n.textContent = 'Question ' + m.q + (m.earned !== null && m.points !== null ? ' — ' + m.earned + ' of ' + m.points + ' points' : ''); card.appendChild(n);
    if (m.prompt) { var p = doc.createElement('div'); p.className = 'mnai-missed-p'; p.textContent = m.prompt; card.appendChild(p); }
    if (m.figure) { var fg = safeSvg(m.figure, doc); if (fg) { card.appendChild(fg); } }
    var you = norm(m.your), key = norm(m.correct);
    if (m.options.length) {
      var ul = doc.createElement('ul'); ul.className = 'mnai-missed-o';
      m.options.forEach(function (o) {
        var li = doc.createElement('li'), t = norm(o), isYou = you && t === you, isKey = key && t === key;
        if (isYou) li.className = 'you'; if (isKey) li.className += (li.className ? ' ' : '') + 'key';
        li.appendChild(doc.createTextNode(o));
        if (isYou || isKey) { var tag = doc.createElement('i'); tag.textContent = isYou && isKey ? ' (your answer, correct)' : isYou ? ' (your answer)' : ' (correct answer)'; li.appendChild(tag); }
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }
    var a = doc.createElement('div'); a.className = 'mnai-missed-a';
    var y = doc.createElement('span'); y.className = 'y'; y.textContent = 'You answered: ' + m.your; a.appendChild(y);
    if (m.correct) { a.appendChild(doc.createTextNode('  ·  ')); var k = doc.createElement('span'); k.className = 'k'; k.textContent = 'Correct answer: ' + m.correct; a.appendChild(k); }
    card.appendChild(a);
    if (m.explanation) { var e = doc.createElement('div'); e.className = 'mnai-missed-e'; e.textContent = m.explanation; card.appendChild(e); }
    root.appendChild(card);
  });
  return root;
}
