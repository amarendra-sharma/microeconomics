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

/** Checks a "missed" spec from the server; returns a clean copy or null. */
export function cleanMissed(spec) {
  if (!spec || spec.kind !== 'missed' || !Array.isArray(spec.items) || !spec.items.length) return null;
  var items = spec.items.slice(0, 60).map(function (m) {
    return {
      q: str(m && m.q, 8), prompt: m && m.prompt ? str(m.prompt, 700) : '', your: str(m && m.your, 160) || 'blank',
      options: Array.isArray(m && m.options) ? m.options.slice(0, 8).map(function (o) { return str(o, 160); }) : [],
      correct: m && m.correct != null ? str(m.correct, 160) : '', explanation: m && m.explanation ? str(m.explanation, 700) : '',
      earned: m && fin(m.earned) ? m.earned : null, points: m && fin(m.points) ? m.points : null
    };
  });
  return { title: str(spec.title, 120), score: fin(spec.score) ? spec.score : null, max: fin(spec.max_score) ? spec.max_score : null, total: fin(spec.total_questions) ? spec.total_questions : null, items: items };
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
  sub.textContent = 'Questions to go over: ' + s.items.length + (s.total ? ' of ' + s.total : ''); root.appendChild(sub);
  s.items.forEach(function (m) {
    var card = doc.createElement('div'); card.className = 'mnai-missed-q';
    var n = doc.createElement('b'); n.className = 'n'; n.textContent = 'Question ' + m.q + (m.earned !== null && m.points !== null ? ' — ' + m.earned + ' of ' + m.points + ' points' : ''); card.appendChild(n);
    if (m.prompt) { var p = doc.createElement('div'); p.className = 'mnai-missed-p'; p.textContent = m.prompt; card.appendChild(p); }
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
