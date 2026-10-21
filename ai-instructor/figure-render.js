// figure-render.js - draws one of the TEXTBOOK'S OWN figures that the server sent as a spec. The markup comes from the course textbook, never from the
// model, but it is still treated as untrusted: every element and attribute is checked against a small allowlist and rebuilt node by node, so a
// bad figure can at worst draw nothing. No scripts, links, images, styles or event handlers can get through.
var SVGNS = 'http://www.w3.org/2000/svg';
var TAGS = { line: 1, polyline: 1, polygon: 1, path: 1, circle: 1, rect: 1, text: 1, tspan: 1, g: 1, defs: 1, marker: 1 };
var NUM = /^-?\d*\.?\d+(e-?\d+)?%?$/i;
var COLOR = /^(none|currentColor|var\(--[a-z0-9]+\)|#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))$/i;
var CHECK = {
  x: NUM, y: NUM, x1: NUM, y1: NUM, x2: NUM, y2: NUM, cx: NUM, cy: NUM, r: NUM, rx: NUM, ry: NUM, dx: NUM, dy: NUM, width: NUM, height: NUM,
  'stroke-width': NUM, opacity: NUM, 'fill-opacity': NUM, 'stroke-opacity': NUM, markerWidth: NUM, markerHeight: NUM, refX: NUM, refY: NUM,
  points: /^[\d\s.,\-e]+$/i, d: /^[0-9eE.,\s\-MmLlHhVvCcSsQqTtAaZz]+$/,
  fill: COLOR, stroke: COLOR, 'stroke-dasharray': /^[\d.\s,]+$/, 'font-size': /^[\d.]+(px)?$/, 'font-weight': /^(normal|bold|[1-9]00)$/, 'font-style': /^(normal|italic)$/,
  'text-anchor': /^(start|middle|end)$/, 'baseline-shift': /^(sub|super)$/, transform: /^(rotate|translate|scale)\([-\d.\s,]+\)$/,
  'stroke-linecap': /^(butt|round|square)$/, 'stroke-linejoin': /^(miter|round|bevel)$/, markerUnits: /^(strokeWidth|userSpaceOnUse)$/, orient: /^(auto|[-\d.]+)$/,
  'marker-end': /^url\(#[\w-]+\)$/, 'marker-start': /^url\(#[\w-]+\)$/, id: /^[\w-]+$/
};
var THEME = '--bright:#f7f9ff;--ink:#e8eef8;--muted:#b4c0cc;--faint:#93a1ae;--line:rgba(255,255,255,.14);--line2:rgba(255,255,255,.4);--violet:#b9acff;--violet2:#d2c9ff;--green:#62e3a4;--amber:#ffc45e;--rose:#ff8088;--blue:#80c6ff;--sans:system-ui,-apple-system,Segoe UI,sans-serif;font-family:system-ui,-apple-system,Segoe UI,sans-serif';
function clone(src, doc, uid) {
  var tag = src.localName;
  if (!TAGS[tag]) return null;
  var el = doc.createElementNS(SVGNS, tag), i, a, v;
  for (i = 0; i < src.attributes.length; i++) {
    a = src.attributes[i]; v = a.value;
    if (!CHECK[a.name] || !CHECK[a.name].test(v)) continue;
    if (a.name === 'id') v = 'f' + uid + '-' + v;
    else if (a.name === 'marker-end' || a.name === 'marker-start') v = v.replace('url(#', 'url(#f' + uid + '-');
    el.setAttribute(a.name, v);
  }
  for (i = 0; i < src.childNodes.length; i++) {
    var n = src.childNodes[i];
    if (n.nodeType === 3) { if (tag === 'text' || tag === 'tspan') el.appendChild(doc.createTextNode(n.nodeValue.slice(0, 200))); }
    else if (n.nodeType === 1) { var c = clone(n, doc, uid); if (c) el.appendChild(c); }
  }
  return el;
}
function parts(doc, svg) {
  if (typeof svg !== 'string' || svg.length > 60000) return [];
  var P = new (doc.defaultView || window).DOMParser(), x = P.parseFromString('<svg xmlns="' + SVGNS + '">' + svg + '</svg>', 'image/svg+xml');
  if (x.getElementsByTagName('parsererror').length) return [];
  return Array.prototype.slice.call(x.documentElement.childNodes);
}
var ESC = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
/**
 * @returns {{title:string, caption:string, svgs:Element[], steps:Element[]}|null}
 * opts.animate: mark curves for draw-on and give every step the board's classes (the whiteboard reveals them one at a time).
 */
export function buildFigure(spec, doc, uid, opts) {
  opts = opts || {};
  if (!spec || spec.kind !== 'figure' || !Array.isArray(spec.panels) || !spec.panels.length || spec.panels.length > 4) return null;
  var svgs = [], steps = [], p, s, k, ok = false;
  for (p = 0; p < spec.panels.length; p++) {
    var panel = spec.panels[p];
    if (!panel || !/^0 0 \d{2,4} \d{2,4}$/.test(panel.viewBox || '') || !Array.isArray(panel.steps) || panel.steps.length > 14) continue;
    var svg = doc.createElementNS(SVGNS, 'svg'); svg.setAttribute('viewBox', panel.viewBox); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', String(spec.title || 'Textbook figure').slice(0, 120)); svg.setAttribute('style', THEME);
    for (s = 0; s < panel.steps.length; s++) {
      var st = panel.steps[s], g = doc.createElementNS(SVGNS, 'g'), nodes = parts(doc, st && st.svg), any = false;
      for (k = 0; k < nodes.length; k++) { if (nodes[k].nodeType !== 1) continue; var c = clone(nodes[k], doc, uid); if (c) { g.appendChild(c); any = true; } }
      if (!any) continue;
      g.setAttribute('class', opts.animate ? 'wb-step' : 'fig-step');
      g.setAttribute('data-s', '1');
      g.setAttribute('data-cap', '<b>' + ESC(String(st.label || '').slice(0, 120)) + '</b>');
      if (opts.animate) {
        var first = null;
        Array.prototype.forEach.call(g.querySelectorAll('polyline,path'), function (el) {
          if (el.closest('marker') || el.hasAttribute('stroke-dasharray') || el.getAttribute('fill') !== 'none') return;
          el.setAttribute('pathLength', '1'); el.setAttribute('class', 'wb-draw'); if (!first) { first = el; el.classList.add('wb-line'); }
        });
        if (first) { var tip = doc.createElementNS(SVGNS, 'circle'); tip.setAttribute('class', 'wb-tip'); tip.setAttribute('r', '5'); tip.setAttribute('cx', '-10'); tip.setAttribute('cy', '-10'); g.appendChild(tip); }
      }
      svg.appendChild(g); steps.push(g); ok = true;
    }
    svgs.push(svg);
  }
  if (!ok) return null;
  return { title: String(spec.title || '').slice(0, 120), num: String(spec.num || '').slice(0, 8), caption: String(spec.caption || '').slice(0, 1400), svgs: svgs, steps: steps };
}
