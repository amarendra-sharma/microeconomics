// graph-render.js - draws what the server validated: a graph spec (numbers and short labels) as an SVG string, and an equation spec with KaTeX.
// The model never supplies markup. Every string is escaped here regardless, numbers are re-checked, and the result contains no scripts, links or
// event handlers. KaTeX is vendored in web/vendor/katex and is called with trust:false, so \href, \url, \includegraphics etc. are inert.
import { buildFigure } from './figure-render.js?v=20261021a';
import { buildScan } from './scan-render.js?v=20261021c';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fin = (v) => typeof v === 'number' && isFinite(v) && Math.abs(v) <= 1e6;
const COLORS = ['#1f5fbf', '#c2410c', '#15803d', '#7e22ce', '#b45309', '#0e7490'];

function niceStep(range, target) {
  var raw = range / Math.max(1, target), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
const fmt = (v) => { var r = Math.round(v * 100) / 100; return String(r); };

/** @returns {string} an <svg> string, or '' when the spec is not drawable */
export function graphToSvg(spec, opt) {
  opt = opt || {};
  if (!spec || spec.kind !== 'graph' || !Array.isArray(spec.series) || !spec.series.length || spec.series.length > 6) return '';
  var W = opt.width || 480, H = opt.height || 320, L = 56, R = 16, T = spec.title ? 34 : 16, B = 48, pw = W - L - R, ph = H - T - B;
  var xs = [0], ys = [0], i, j;
  for (i = 0; i < spec.series.length; i++) {
    var pts = spec.series[i].points; if (!Array.isArray(pts) || pts.length < 2 || pts.length > 80) return '';
    for (j = 0; j < pts.length; j++) { if (!Array.isArray(pts[j]) || !fin(pts[j][0]) || !fin(pts[j][1])) return ''; xs.push(pts[j][0]); ys.push(pts[j][1]); }
  }
  var markers = (spec.markers || []).filter((m) => m && fin(m.x) && fin(m.y)).slice(0, 8);
  markers.forEach((m) => { xs.push(m.x); ys.push(m.y); });
  var xmax = fin(spec.x_max) && spec.x_max > 0 ? spec.x_max : Math.max.apply(null, xs), ymax = fin(spec.y_max) && spec.y_max > 0 ? spec.y_max : Math.max.apply(null, ys);
  var xmin = Math.min(0, Math.min.apply(null, xs)), ymin = Math.min(0, Math.min.apply(null, ys));
  if (xmax <= xmin) xmax = xmin + 1; if (ymax <= ymin) ymax = ymin + 1;
  var sx = (x) => L + ((x - xmin) / (xmax - xmin)) * pw, sy = (y) => T + ph - ((y - ymin) / (ymax - ymin)) * ph;
  var out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(spec.title || (spec.y_label + ' versus ' + spec.x_label)) + '" font-family="system-ui,sans-serif" font-size="12">'];
  if (spec.title) out.push('<text x="' + W / 2 + '" y="20" text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">' + esc(spec.title) + '</text>');
  var xt = niceStep(xmax - xmin, 6), yt = niceStep(ymax - ymin, 5), v;
  for (v = Math.ceil(xmin / xt) * xt; v <= xmax + 1e-9; v += xt) out.push('<line x1="' + sx(v).toFixed(1) + '" y1="' + T + '" x2="' + sx(v).toFixed(1) + '" y2="' + (T + ph) + '" stroke="currentColor" stroke-opacity=".12"/><text x="' + sx(v).toFixed(1) + '" y="' + (T + ph + 16) + '" text-anchor="middle" fill="currentColor">' + esc(fmt(v)) + '</text>');
  for (v = Math.ceil(ymin / yt) * yt; v <= ymax + 1e-9; v += yt) out.push('<line x1="' + L + '" y1="' + sy(v).toFixed(1) + '" x2="' + (L + pw) + '" y2="' + sy(v).toFixed(1) + '" stroke="currentColor" stroke-opacity=".12"/><text x="' + (L - 6) + '" y="' + (sy(v) + 4).toFixed(1) + '" text-anchor="end" fill="currentColor">' + esc(fmt(v)) + '</text>');
  out.push('<rect x="' + L + '" y="' + T + '" width="' + pw + '" height="' + ph + '" fill="none" stroke="currentColor" stroke-opacity=".5"/>');
  out.push('<defs><clipPath id="gclip"><rect x="' + L + '" y="' + T + '" width="' + pw + '" height="' + ph + '"/></clipPath></defs>');
  spec.series.forEach(function (s, k) {
    var d = s.points.map((p, n) => (n ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1)).join(' '), c = COLORS[k % COLORS.length];
    out.push('<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="2.2" clip-path="url(#gclip)"' + (s.dashed ? ' stroke-dasharray="6 4"' : '') + '/>');
    var last = s.points[s.points.length - 1];
    out.push('<text x="' + Math.min(L + pw - 2, sx(last[0]) + 4).toFixed(1) + '" y="' + Math.max(T + 12, sy(last[1]) - 4).toFixed(1) + '" text-anchor="' + (sx(last[0]) > L + pw - 60 ? 'end' : 'start') + '" fill="' + c + '" font-weight="600">' + esc(s.label) + '</text>');
  });
  markers.forEach(function (m) {
    out.push('<line x1="' + sx(m.x).toFixed(1) + '" y1="' + sy(m.y).toFixed(1) + '" x2="' + sx(m.x).toFixed(1) + '" y2="' + (T + ph) + '" stroke="currentColor" stroke-dasharray="3 3" stroke-opacity=".6"/>');
    out.push('<line x1="' + L + '" y1="' + sy(m.y).toFixed(1) + '" x2="' + sx(m.x).toFixed(1) + '" y2="' + sy(m.y).toFixed(1) + '" stroke="currentColor" stroke-dasharray="3 3" stroke-opacity=".6"/>');
    out.push('<circle cx="' + sx(m.x).toFixed(1) + '" cy="' + sy(m.y).toFixed(1) + '" r="4.5" fill="currentColor"/><text x="' + (sx(m.x) + 7).toFixed(1) + '" y="' + (sy(m.y) - 7).toFixed(1) + '" fill="currentColor" font-weight="600">' + esc(m.label) + '</text>');
  });
  out.push('<text x="' + (L + pw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" fill="currentColor">' + esc(spec.x_label) + '</text>');
  out.push('<text transform="rotate(-90)" x="' + -(T + ph / 2) + '" y="14" text-anchor="middle" fill="currentColor">' + esc(spec.y_label) + '</text></svg>');
  return out.join('');
}

/** Renders an equation spec into `el` using the vendored KaTeX. Falls back to plain text (never HTML) if KaTeX is missing or refuses the input. */
export function renderEquation(spec, el, katex) {
  if (!spec || spec.kind !== 'equation' || typeof spec.tex !== 'string' || spec.tex.length > 300) return false;
  try {
    if (!katex) throw new Error('no katex');
    katex.render(spec.tex, el, { trust: false, throwOnError: true, displayMode: true, strict: 'error', maxSize: 20, maxExpand: 200 });
  } catch (e) { el.textContent = spec.tex; }
  if (spec.caption) { var c = el.ownerDocument.createElement('div'); c.textContent = spec.caption; c.className = 'eq-caption'; el.appendChild(c); }
  return true;
}

/** One entry point for the page: figure out the spec kind and mount it into `host`. Returns the element it added. */
export function mountVisual(spec, host, katex) {
  if (!spec || !host) return null; var d = host.ownerDocument, box = d.createElement('figure'); box.className = 'ai-visual';
  if (spec.kind === 'scan') { var sc = buildScan(spec, d, window.sb); if (!sc) return null; box.style.cssText = 'padding:0;background:transparent'; box.appendChild(sc); host.appendChild(box); return box; }   // the student's own graded paper exam
  if (spec.kind === 'graph') { var svg = graphToSvg(spec); if (!svg) return null; box.innerHTML = svg; }   // svg is built only from escaped strings and checked numbers
  else if (spec.kind === 'figure') {
    var fg = buildFigure(spec, d, Math.floor(Math.random() * 1e6), { animate: false }); if (!fg) return null;
    box.style.cssText = 'background:#0e1117;color:#d7deec;border-radius:8px;padding:8px 10px';
    var t = d.createElement('div'); t.textContent = 'Figure ' + fg.num + ' \u2014 ' + fg.title; t.style.cssText = 'font:600 13px system-ui,sans-serif;color:#ffd966;margin-bottom:4px'; box.appendChild(t);
    fg.svgs.forEach(function (sv) { sv.style.cssText += ';width:100%;height:auto;display:block'; box.appendChild(sv); });
  }
  else if (spec.kind === 'equation') { if (!renderEquation(spec, box, katex)) return null; }
  else return null;
  host.appendChild(box); return box;
}
