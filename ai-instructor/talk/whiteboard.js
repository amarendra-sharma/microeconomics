// whiteboard.js - the instructor's blackboard. It sits between the instructor and the chat in Talk mode, draws what the server validated (a graph
// spec or an equation spec) and reveals it ONE STEP AT A TIME, in step with what the instructor is saying: axes first, then each curve drawn on,
// then each marked point. Every string is escaped and every number re-checked here; the model never supplies markup.
import { buildFigure } from '../figure-render.js?v=20261021a';
import { buildScan } from '../scan-render.js?v=20261021c';
import { buildMissed } from '../missed-render.js?v=20261025d';
var CSS = [
'.mnai-board{order:1;display:flex;flex-direction:column;min-width:0;background:#15302c;color:#f3f1e7;border:7px solid #7b5b3a;border-radius:12px;box-shadow:inset 0 0 40px rgba(0,0,0,.45),0 6px 20px rgba(0,0,0,.4);padding:8px 10px 10px}',
'.mnai-board[hidden]{display:none}',
'.mnai-board-head{display:flex;align-items:center;gap:8px;font:600 13px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#cfd8c6;opacity:.85;margin-bottom:6px}',
'.mnai-board-head span{flex:1}.mnai-board-head button{min-height:28px;border-radius:6px;border:1px solid #6f8a80;background:transparent;color:#cfd8c6;font:inherit;text-transform:none;letter-spacing:0;padding:0 8px;cursor:pointer}',
'.mnai-board-body{flex:1;overflow:auto;display:flex;flex-direction:column;gap:10px;align-items:stretch}',
'.mnai-board svg{width:100%;height:auto;max-height:78vh;display:block}',
'.wb-step{opacity:0;transition:opacity .45s ease}.wb-step.on{opacity:1}.wb-live .wb-step.on:not(.cur){opacity:.55}',
'.wb-step.cur .wb-line{stroke-width:5.2;filter:drop-shadow(0 0 5px currentColor)}.wb-line{transition:stroke-width .4s ease}',
'.wb-step.cur .wb-lab{font-size:16px}.wb-step.cur .wb-pop circle{filter:drop-shadow(0 0 8px #fff5b0)}',
'.wb-tip{fill:#fff;opacity:0;filter:drop-shadow(0 0 6px #fff)}',
'.wb-cap{min-height:2.6em;margin-top:6px;padding:6px 10px;border-radius:8px;background:rgba(0,0,0,.28);font:500 14px/1.35 system-ui,sans-serif;color:#f3f1e7}.wb-cap b{color:#ffd966;font-weight:700}',
'.wb-draw{stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset 1.4s ease-in-out}.wb-step.on .wb-draw{stroke-dashoffset:0}',
'.wb-lab{opacity:0;transition:opacity .5s ease 1.1s}.wb-step.on .wb-lab{opacity:1}',
'.wb-pop circle{transform-box:fill-box;transform-origin:center;transform:scale(0);transition:transform .45s cubic-bezier(.3,1.7,.5,1) .35s}.wb-step.on .wb-pop circle{transform:scale(1)}',
'.wb-guide{stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset .6s ease}.wb-step.on .wb-guide{stroke-dashoffset:0}',
'.wb-figtitle{font:600 14px/1.3 system-ui,sans-serif;color:#ffd966;margin:2px 2px 6px}',
'.wb-eq{opacity:0;transform:translateY(8px);transition:opacity .5s ease,transform .5s ease;font-size:1.25em;text-align:center;padding:6px 4px;overflow-x:auto}.wb-eq.on{opacity:1;transform:none}',
'.wb-eq .eq-caption{font-size:.62em;color:#cfd8c6;margin-top:4px}',
'@media (prefers-reduced-motion:reduce){.wb-step,.wb-draw,.wb-lab,.wb-pop circle,.wb-guide,.wb-eq{transition:none!important}}',
'@media (min-width:860px){.mnai-talk-box:has(.mnai-has-board){width:min(1380px,100%)}.mnai.mnai-has-board{max-width:none;grid-template-columns:minmax(300px,.72fr) minmax(0,1.6fr);align-items:start}.mnai.mnai-has-board>.mnai-stage{grid-column:1;max-height:44vh;aspect-ratio:4/3}.mnai.mnai-has-board>.mnai-board{grid-column:2;grid-row:1/span 8;align-self:stretch;min-height:min(86vh,980px)}.mnai.mnai-has-board>:not(.mnai-stage):not(.mnai-board){grid-column:1}}'
].join('\n');
var CHALK = ['#ffd966', '#8ed1fc', '#ff9e9e', '#b6f2a0', '#d9b3ff', '#ffc58a'];
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var fin = function (v) { return typeof v === 'number' && isFinite(v) && Math.abs(v) <= 1e6; };
function niceStep(range, target) { var raw = range / Math.max(1, target), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }
var fmt = function (v) { return String(Math.round(v * 100) / 100); };

/** Builds the SVG string for a graph spec. Each reveal step is a <g class="wb-step" data-s="n">. Returns { svg, steps } or null. */
/** Smooth path through a few points (Catmull-Rom to Bezier); dense point lists are already smooth, so they are joined directly. */
function pathD(P) {
  var n = P.length, d = 'M' + P[0][0].toFixed(1) + ' ' + P[0][1].toFixed(1), i;
  if (n < 12 && n > 2) {
    for (i = 0; i < n - 1; i++) {
      var p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)];
      d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
  } else { for (i = 1; i < n; i++) d += ' L' + P[i][0].toFixed(1) + ' ' + P[i][1].toFixed(1); }
  return d;
}
function niceCeil(v, step) { return Math.ceil(v / step - 1e-9) * step; }
export function graphBoardSvg(spec, uid) {
  if (!spec || spec.kind !== 'graph' || !Array.isArray(spec.series) || !spec.series.length || spec.series.length > 6) return null;
  var W = 520, H = 360, L = 58, R = 24, T = spec.title ? 40 : 20, B = 52, pw = W - L - R, ph = H - T - B, xs = [0], ys = [0], i, j;
  for (i = 0; i < spec.series.length; i++) {
    var pts = spec.series[i].points; if (!Array.isArray(pts) || pts.length < 2 || pts.length > 200) return null;
    for (j = 0; j < pts.length; j++) { if (!Array.isArray(pts[j]) || !fin(pts[j][0]) || !fin(pts[j][1])) return null; xs.push(pts[j][0]); ys.push(pts[j][1]); }
  }
  var markers = (spec.markers || []).filter(function (m) { return m && fin(m.x) && fin(m.y); }).slice(0, 8);
  markers.forEach(function (m) { xs.push(m.x); ys.push(m.y); });
  var xmin = Math.min(0, Math.min.apply(null, xs)), ymin = Math.min(0, Math.min.apply(null, ys));
  var xmax = Math.max.apply(null, xs), ymax = Math.max.apply(null, ys);
  if (xmax <= xmin) xmax = xmin + 1; if (ymax <= ymin) ymax = ymin + 1;
  var xt = niceStep(xmax - xmin, 6), yt = niceStep(ymax - ymin, 5);
  // axes end on a tick, so nothing is clipped and every label is a round number; an explicit x_max / y_max from the instructor wins
  xmax = fin(spec.x_max) && spec.x_max > xmin ? spec.x_max : niceCeil(xmax, xt);
  ymax = fin(spec.y_max) && spec.y_max > ymin ? spec.y_max : niceCeil(ymax, yt);
  var sx = function (x) { return L + ((x - xmin) / (xmax - xmin)) * pw; }, sy = function (y) { return T + ph - ((y - ymin) / (ymax - ymin)) * ph; };
  var ink = '#f3f1e7', n = 0, o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(spec.title || (spec.y_label + ' versus ' + spec.x_label)) + '" font-family="system-ui,sans-serif" font-size="13" fill="' + ink + '">'];
  o.push('<defs><clipPath id="wbc' + uid + '"><rect x="' + (L - 2) + '" y="' + (T - 4) + '" width="' + (pw + 8) + '" height="' + (ph + 8) + '"/></clipPath></defs>');
  // step 0: the axes, grid, title and axis names
  o.push('<g class="wb-step" data-s="' + (n++) + '" data-cap="' + esc('<b>The axes.</b> Horizontal: ' + esc(spec.x_label) + '. Vertical: ' + esc(spec.y_label) + '.') + '">');
  if (spec.title) o.push('<text x="' + W / 2 + '" y="23" text-anchor="middle" font-size="16" font-weight="600">' + esc(spec.title) + '</text>');
  var v;
  for (v = Math.ceil(xmin / xt - 1e-9) * xt; v <= xmax + 1e-9; v += xt) o.push('<line x1="' + sx(v).toFixed(1) + '" y1="' + T + '" x2="' + sx(v).toFixed(1) + '" y2="' + (T + ph) + '" stroke="' + ink + '" stroke-opacity=".12"/><text x="' + sx(v).toFixed(1) + '" y="' + (T + ph + 18) + '" text-anchor="middle" fill-opacity=".8">' + fmt(v) + '</text>');
  for (v = Math.ceil(ymin / yt - 1e-9) * yt; v <= ymax + 1e-9; v += yt) o.push('<line x1="' + L + '" y1="' + sy(v).toFixed(1) + '" x2="' + (L + pw) + '" y2="' + sy(v).toFixed(1) + '" stroke="' + ink + '" stroke-opacity=".12"/><text x="' + (L - 8) + '" y="' + (sy(v) + 4).toFixed(1) + '" text-anchor="end" fill-opacity=".8">' + fmt(v) + '</text>');
  o.push('<path d="M' + L + ' ' + T + ' L' + L + ' ' + (T + ph) + ' L' + (L + pw) + ' ' + (T + ph) + '" fill="none" stroke="' + ink + '" stroke-width="2"/>');
  o.push('<text x="' + (L + pw / 2) + '" y="' + (H - 10) + '" text-anchor="middle" font-weight="600">' + esc(spec.x_label) + '</text>');
  o.push('<text transform="rotate(-90)" x="' + -(T + ph / 2) + '" y="16" text-anchor="middle" font-weight="600">' + esc(spec.y_label) + '</text></g>');
  // one step per curve: traced on by a chalk tip, glowing while it is the one being explained; its name fades in
  spec.series.forEach(function (s, k) {
    var P = s.points.map(function (p) { return [sx(p[0]), sy(p[1])]; }), d = pathD(P), c = CHALK[k % CHALK.length], last = s.points[s.points.length - 1], id = uid + '_' + k;
    var cap = '<b>' + esc(s.label) + '.</b> ' + esc(typeof s.note === 'string' ? s.note : '');
    o.push('<g class="wb-step" data-s="' + (n++) + '" data-cap="' + esc(cap) + '" style="color:' + c + '">');
    o.push('<mask id="wbm' + id + '" maskUnits="userSpaceOnUse" x="0" y="0" width="' + W + '" height="' + H + '"><path class="wb-draw wb-trace" pathLength="1" d="' + d + '" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></mask>');
    o.push('<g mask="url(#wbm' + id + ')" clip-path="url(#wbc' + uid + ')"><path class="wb-line" d="' + d + '" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"' + (s.dashed ? ' stroke-dasharray="9 7"' : '') + '/></g>');
    o.push('<circle class="wb-tip" r="5.5" cx="' + P[0][0].toFixed(1) + '" cy="' + P[0][1].toFixed(1) + '"/>');
    o.push('<text class="wb-lab" x="' + Math.min(L + pw - 2, sx(last[0]) + 6).toFixed(1) + '" y="' + Math.max(T + 14, sy(last[1]) - 8).toFixed(1) + '" text-anchor="' + (sx(last[0]) > L + pw - 90 ? 'end' : 'start') + '" fill="currentColor" font-weight="700" font-size="14" paint-order="stroke" stroke="#15302c" stroke-width="3">' + esc(s.label) + '</text></g>');
  });
  // one step per marked point: guide lines, then the dot pops in
  markers.forEach(function (m) {
    var cap = '<b>' + esc(m.label) + '.</b> ' + esc(typeof m.note === 'string' ? m.note : '');
    o.push('<g class="wb-step" data-s="' + (n++) + '" data-cap="' + esc(cap) + '"><line class="wb-guide" pathLength="1" x1="' + sx(m.x).toFixed(1) + '" y1="' + sy(m.y).toFixed(1) + '" x2="' + sx(m.x).toFixed(1) + '" y2="' + (T + ph) + '" stroke="' + ink + '" stroke-opacity=".7" stroke-dasharray="1"/>');
    o.push('<line class="wb-guide" pathLength="1" x1="' + L + '" y1="' + sy(m.y).toFixed(1) + '" x2="' + sx(m.x).toFixed(1) + '" y2="' + sy(m.y).toFixed(1) + '" stroke="' + ink + '" stroke-opacity=".7"/>');
    o.push('<g class="wb-pop"><circle cx="' + sx(m.x).toFixed(1) + '" cy="' + sy(m.y).toFixed(1) + '" r="6" fill="#fff5b0"/></g><text class="wb-lab" x="' + (sx(m.x) + 10).toFixed(1) + '" y="' + (sy(m.y) - 10).toFixed(1) + '" fill="#fff5b0" font-weight="700" font-size="14" paint-order="stroke" stroke="#15302c" stroke-width="3">' + esc(m.label) + '</text></g>');
  });
  o.push('</svg>');
  return { svg: o.join(''), steps: n };
}

export function Whiteboard(doc, opts) {
  opts = opts || {};
  this.doc = doc; this.uid = 0; this.steps = []; this.next = 0; this.baseline = 0; this.armed = false; this.onVisibility = opts.onVisibility || function () {};
  if (!doc.getElementById('mnai-board-styles')) { var st = doc.createElement('style'); st.id = 'mnai-board-styles'; st.textContent = CSS; doc.head.appendChild(st); }
  var el = this.el = doc.createElement('div'); el.className = 'mnai-board'; el.hidden = true; el.setAttribute('aria-label', 'Whiteboard'); el.setAttribute('role', 'region');
  var head = doc.createElement('div'); head.className = 'mnai-board-head';
  var title = doc.createElement('span'); title.textContent = 'Whiteboard';
  var hide = doc.createElement('button'); hide.type = 'button'; hide.textContent = 'Hide'; var self = this; hide.addEventListener('click', function () { self._show(false); });
  head.append(title, hide);
  this.body = doc.createElement('div'); this.body.className = 'mnai-board-body';
  el.append(head, this.body);
}
Whiteboard.prototype._show = function (on) { this.el.hidden = !on; this.onVisibility(on); };
/** New student question: wipe the board. */
Whiteboard.prototype.reset = function () { this.body.querySelectorAll('.mnai-scan').forEach(function (n) { if (n._revoke) n._revoke(); }); if (this._fb) (this.doc.defaultView || window).clearTimeout(this._fb); this.body.textContent = ''; this.el.classList.remove('wb-live'); this.steps = []; this.next = 0; this.armed = false; this.baseline = 0; this._show(false); };
/**
 * A drawing arrived from the server. `baseline` is how many sentences had already been queued for speech (they come BEFORE the drawing);
 * the board then advances one step for each LATER sentence the instructor starts to say.
 */
Whiteboard.prototype.add = function (spec, katex, baseline) {
  var d = this.doc, ok = false;
  if (spec && spec.kind === 'graph') {
    var g = graphBoardSvg(spec, ++this.uid);
    if (g) {
      var holder = d.createElement('div'); holder.innerHTML = g.svg;           // built only from escaped strings and checked numbers
      var base = this.steps.length;
      var cap = d.createElement('div'); cap.className = 'wb-cap'; cap.setAttribute('aria-live', 'polite');
      holder.querySelectorAll('[data-s]').forEach(function (n) { n._cap = cap; this.steps.push(n); }, this);
      this.body.appendChild(holder); this.body.appendChild(cap); ok = this.steps.length > base;
    }
  } else if (spec && spec.kind === 'figure') {
    var fg = buildFigure(spec, d, ++this.uid, { animate: true });
    if (fg) {
      var fcap = d.createElement('div'); fcap.className = 'wb-cap'; fcap.setAttribute('aria-live', 'polite');
      var ft = d.createElement('div'); ft.className = 'wb-figtitle'; ft.textContent = 'Figure ' + fg.num + ' \u2014 ' + fg.title;
      this.body.appendChild(ft); fg.svgs.forEach(function (sv) { this.body.appendChild(sv); }, this);
      fg.steps.forEach(function (n) { n._cap = fcap; this.steps.push(n); }, this);
      this.body.appendChild(fcap); ok = true;
    }
  } else if (spec && spec.kind === 'scan') {
    // The student's own graded sheet: shown at once (it is not a step-by-step drawing) and kept until the next question.
    var sc = buildScan(spec, d, (d.defaultView || window).sb); if (sc) { sc.classList.add('wb-scan'); this.body.appendChild(sc); ok = true; }
  } else if (spec && spec.kind === 'missed') {
    // The questions the student missed on their own graded exam: shown at once, kept until the next question.
    var ms = buildMissed(spec, d); if (ms) { ms.classList.add('wb-scan'); this.body.appendChild(ms); ok = true; }
  } else if (spec && spec.kind === 'equation' && typeof spec.tex === 'string' && spec.tex.length <= 300) {
    var box = d.createElement('div'); box.className = 'wb-eq';
    try { if (!katex) throw new Error('no katex'); katex.render(spec.tex, box, { trust: false, throwOnError: true, displayMode: true, strict: 'error', maxSize: 20, maxExpand: 200 }); } catch (e) { box.textContent = spec.tex; }
    if (spec.caption) { var c = d.createElement('div'); c.className = 'eq-caption'; c.textContent = spec.caption; box.appendChild(c); }
    this.steps.push(box); this.body.appendChild(box); ok = true;
  }
  if (!ok) return false;
  if (!this.armed) {
    this.armed = true; this.baseline = baseline || 0; this._saw = false; this._show(true);
    this._watch();
  }      // the board opens blank, like a teacher stepping up to it; the first sentence she says after that draws the first step
  return true;
};
/** Safety net for a muted device or a failed voice: if nothing is spoken for a long while, show the whole drawing. Every sentence restarts it, so a slow voice never triggers it. */
Whiteboard.prototype._watch = function () {
  var self = this, w = this.doc.defaultView || window;
  if (this._fb) w.clearTimeout(this._fb);
  this._fb = w.setTimeout(function () { self.finish(); }, 45000);
};
Whiteboard.prototype.advance = function () {
  var s = this.steps[this.next]; if (!s) return false;
  this.next++;
  var self = this, w = this.doc.defaultView || window;
  this.el.classList.add('wb-live');
  this.steps.forEach(function (p) { p.classList.remove('cur'); });
  w.requestAnimationFrame(function () {
    s.classList.add('on'); s.classList.add('cur');
    if (s._cap) { var h = s.getAttribute('data-cap'); if (h) { s._cap.textContent = ''; var tmp = self.doc.createElement('div'); tmp.innerHTML = h; while (tmp.firstChild) s._cap.appendChild(tmp.firstChild); } }
    self._trace(s, w);
    try { s.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ok */ }
  });
  return true;
};
/** A bright chalk tip runs along the curve while it draws on, so the eye follows what is being explained. */
Whiteboard.prototype._trace = function (s, w) {
  var tip = s.querySelector('.wb-tip'), path = s.querySelector('.wb-line'); if (!tip || !path || !path.getTotalLength) return;
  var len; try { len = path.getTotalLength(); } catch (e) { return; }
  var t0 = null, dur = 1400;
  var ease = function (t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  tip.style.opacity = 1;
  function frame(ts) {
    if (t0 === null) t0 = ts; var k = Math.min(1, (ts - t0) / dur), pt;
    try { pt = path.getPointAtLength(len * ease(k)); tip.setAttribute('cx', pt.x); tip.setAttribute('cy', pt.y); } catch (e) { tip.style.opacity = 0; return; }
    if (k < 1) w.requestAnimationFrame(frame); else w.setTimeout(function () { tip.style.opacity = 0; }, 250);
  }
  w.requestAnimationFrame(frame);
};
/** The instructor has just started saying sentence number `index` (1-based within this answer). */
Whiteboard.prototype.onSentence = function (index) { if (!this.armed) return; this._watch(); if (index > this.baseline) { this._saw = true; this.advance(); } };
/** The instructor has finished: show whatever is left so the board is always complete. */
Whiteboard.prototype.finish = function () { var self = this, w = this.doc.defaultView || window; while (this.advance()) { /* reveal the rest */ } w.setTimeout(function () { self.steps.forEach(function (p) { p.classList.remove('cur'); }); self.el.classList.remove('wb-live'); }, 2600); };
