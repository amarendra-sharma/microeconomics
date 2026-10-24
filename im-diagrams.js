/* ============================================================================
   im-diagrams.js  —  parameter-driven SVG economic-diagram renderer for the
   Intro Micro question banks.

   Every graphical question supplies a spec object; renderDiagram(spec) returns
   an SVG string. Because diagrams are drawn from parameters (not stored images),
   the SAME question template can be randomized per student: change the numbers,
   the diagram redraws, and the correct answer is recomputed from those numbers.

   Design goals:
     * Clean, labeled, shaded economic diagrams (surplus, DWL, tax, shifts).
     * House style (navy demand-ish, gold supply-ish, green/red shading).
     * Safari-safe plain JS (no template literals, no optional chaining).
     * Pure function: no DOM needed to BUILD the svg string; caller injects it.

   Supported diagram types (spec.type):
     'supply_demand'   — linear S & D, optional equilibrium marker + surplus/DWL
     'shift'           — a curve shifting (D1->D2 or S1->S2) with new equilibrium
     'price_control'   — price floor/ceiling with shortage/surplus bracket
     'tax'             — per-unit tax wedge with revenue + DWL
     'elasticity'      — a single curve annotated steep/flat with %∆ arrows
     'curve'           — a generic labeled linear curve (for MC/ATC-style later)

   Coordinate convention: economics axes — x = quantity (right), y = price (up).
   We map economic (q,p) into SVG pixel space with a small helper.
   ============================================================================ */
(function (global) {
  "use strict";

  var C = {
    axis:   "#334155",
    grid:   "#e9edf3",
    guide:  "#475569",
    demand: "#0f3d9e",   /* navy */
    supply: "#b87408",   /* gold */
    alt:    "#7c3aed",   /* violet for a second/shifted curve */
    surplus:"#16653422", /* translucent green fill */
    surplusStroke: "#166534",
    dwl:    "#991b1b22",  /* translucent red fill */
    dwlStroke: "#991b1b",
    ink:    "#0f172a",
    muted:  "#64748b",
    label:  "#0f172a"
  };

  /* ---- geometry: a plot box inside the svg viewBox --------------------- */
  function makePlot(opts) {
    var W = opts.w || 440, H = opts.h || 330;
    var m = { l: 52, r: 20, t: 18, b: 50 };
    var qmax = opts.qmax || 10, pmax = opts.pmax || 10;
    var x0 = m.l, x1 = W - m.r, y0 = H - m.b, y1 = m.t;
    function X(q) { return x0 + (q / qmax) * (x1 - x0); }
    function Y(p) { return y0 - (p / pmax) * (y0 - y1); }
    /* mustX / mustY are the values a student may be asked to read off this
       diagram. The tick step is chosen so each of them lands ON a gridline,
       which is the whole point: no question should need a guess between two
       labels. extraX / extraY collect values marked while drawing, so their
       labels can be written after the curves. */
    return { W: W, H: H, m: m, qmax: qmax, pmax: pmax, X: X, Y: Y,
             x0: x0, x1: x1, y0: y0, y1: y1,
             mustX: (opts.mustX || []), mustY: (opts.mustY || []),
             extraX: [], extraY: [] };
  }

  /* A tick step that is a round number, keeps the count sensible, and divides
     every value the question turns on. */
  function chooseStep(max, must) {
    if (!(max > 0)) { return 1; }
    var mags = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    var i, j, hits, st, n, fallback = null;
    for (i = 0; i < mags.length; i++) {
      st = mags[i];
      n = Math.floor(max / st + 1e-9);
      if (n < 3 || n > 14) { continue; }
      if (fallback === null) { fallback = st; }
      hits = true;
      for (j = 0; j < (must || []).length; j++) {
        var v = must[j];
        if (v === null || v === undefined || !isFinite(v)) { continue; }
        if (Math.abs(v / st - Math.round(v / st)) > 1e-6) { hits = false; break; }
      }
      if (hits) { return st; }
    }
    return fallback || (max / 5);
  }

  function tickList(max, must) {
    var st = chooseStep(max, must), out = [], v;
    for (v = 0; v <= max + 1e-9; v += st) { out.push(Math.round(v * 1e6) / 1e6); }
    return out;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function line(x1, y1, x2, y2, stroke, width, dash) {
    return "<line x1='" + x1 + "' y1='" + y1 + "' x2='" + x2 + "' y2='" + y2 +
      "' stroke='" + stroke + "' stroke-width='" + (width || 1) + "'" +
      (dash ? " stroke-dasharray='" + dash + "'" : "") + " />";
  }
  function txt(x, y, s, opts) {
    opts = opts || {};
    return "<text x='" + x + "' y='" + y + "' fill='" + (opts.fill || C.label) +
      "' font-family='Inter, system-ui, sans-serif' font-size='" + (opts.size || 12) +
      "'" + (opts.weight ? " font-weight='" + opts.weight + "'" : "") +
      (opts.anchor ? " text-anchor='" + opts.anchor + "'" : "") + ">" + esc(s) + "</text>";
  }
  function poly(points, fill, stroke) {
    var d = points.map(function (p) { return p[0] + "," + p[1]; }).join(" ");
    return "<polygon points='" + d + "' fill='" + (fill || "none") + "'" +
      (stroke ? " stroke='" + stroke + "' stroke-width='1'" : "") + " />";
  }

  /* axes with a numbered scale, a hairline grid, arrowheads and titles */
  function axes(P, xlab, ylab) {
    var s = "", i, v;
    P.ticksX = tickList(P.qmax, P.mustX);
    P.ticksY = tickList(P.pmax, P.mustY);
    /* grid first, so everything else draws over it */
    for (i = 0; i < P.ticksX.length; i++) {
      v = P.ticksX[i];
      if (v <= 0) { continue; }
      s += line(P.X(v), P.y0, P.X(v), P.y1, C.grid, 1);
    }
    for (i = 0; i < P.ticksY.length; i++) {
      v = P.ticksY[i];
      if (v <= 0) { continue; }
      s += line(P.x0, P.Y(v), P.x1, P.Y(v), C.grid, 1);
    }
    s += line(P.x0, P.y0, P.x1, P.y0, C.axis, 1.5);          /* x axis */
    s += line(P.x0, P.y0, P.x0, P.y1, C.axis, 1.5);          /* y axis */
    /* tick marks only — the numbers are drawn last, so a tick that would sit
       under a marked value's label can be dropped instead of colliding */
    for (i = 0; i < P.ticksX.length; i++) {
      s += line(P.X(P.ticksX[i]), P.y0, P.X(P.ticksX[i]), P.y0 + 4, C.axis, 1);
    }
    for (i = 0; i < P.ticksY.length; i++) {
      if (P.ticksY[i] <= 0) { continue; }
      s += line(P.x0 - 4, P.Y(P.ticksY[i]), P.x0, P.Y(P.ticksY[i]), C.axis, 1);
    }
    /* arrowheads */
    s += "<polygon points='" + P.x1 + "," + P.y0 + " " + (P.x1 - 6) + "," + (P.y0 - 4) + " " + (P.x1 - 6) + "," + (P.y0 + 4) + "' fill='" + C.axis + "'/>";
    s += "<polygon points='" + P.x0 + "," + P.y1 + " " + (P.x0 - 4) + "," + (P.y1 + 6) + " " + (P.x0 + 4) + "," + (P.y1 + 6) + "' fill='" + C.axis + "'/>";
    s += txt(P.x1, P.y0 + 34, xlab || "Quantity", { anchor: "end", fill: C.muted, size: 12, weight: 600 });
    s += txt(P.x0 - 36, P.y1 - 6, ylab || "Price", { fill: C.muted, size: 12, weight: 600 });
    return s;
  }

  /* draw a linear curve p = a + b*q  (b>0 supply, b<0 demand), clipped to box */
  function linearCurve(P, a, b, stroke, labelTxt, labelAtQ) {
    /* Draw the line p = a + b*q, clipped to the plot box [0,qmax]x[0,pmax]
       WITHOUT distorting its slope. We find the two points where the line
       crosses the box boundary and draw between them. Clamping price directly
       would bend the line and move intersections — that was the old bug. */
    var pts = clipLineToBox(P, a, b);
    if (!pts) { return ""; }   /* line doesn't pass through the visible box */
    var s = line(P.X(pts.q1), P.Y(pts.p1), P.X(pts.q2), P.Y(pts.p2), stroke, 2.5);
    if (labelTxt) {
      /* place the label at a q where the line is inside the box */
      var lq = (labelAtQ != null) ? labelAtQ : (pts.q1 + pts.q2) / 2 + (pts.q2 - pts.q1) * 0.32;
      if (lq > pts.q2) { lq = pts.q2; } if (lq < pts.q1) { lq = pts.q1; }
      var lp = a + b * lq;
      s += txt(P.X(lq) + 6, P.Y(lp) - 4, labelTxt, { fill: stroke, weight: 700, size: 13 });
    }
    return s;
  }

  /* Clip the infinite line p=a+b*q to the box q in [0,qmax], p in [0,pmax].
     Returns {q1,p1,q2,p2} of the visible segment, or null if none is visible. */
  function clipLineToBox(P, a, b) {
    var cand = [];
    /* intersections with the four edges, keep those within the box */
    /* left edge q=0 */
    var pL = a + b * 0;
    if (pL >= 0 && pL <= P.pmax) { cand.push({ q: 0, p: pL }); }
    /* right edge q=qmax */
    var pR = a + b * P.qmax;
    if (pR >= 0 && pR <= P.pmax) { cand.push({ q: P.qmax, p: pR }); }
    if (Math.abs(b) > 1e-9) {
      /* bottom edge p=0 -> q=(0-a)/b */
      var qB = (0 - a) / b;
      if (qB >= 0 && qB <= P.qmax) { cand.push({ q: qB, p: 0 }); }
      /* top edge p=pmax -> q=(pmax-a)/b */
      var qT = (P.pmax - a) / b;
      if (qT >= 0 && qT <= P.qmax) { cand.push({ q: qT, p: P.pmax }); }
    }
    if (cand.length < 2) { return null; }
    /* pick the two most separated candidates (handles corner duplicates) */
    var best = null, bd = -1;
    for (var i = 0; i < cand.length; i++) {
      for (var j = i + 1; j < cand.length; j++) {
        var dq = cand[i].q - cand[j].q, dp = cand[i].p - cand[j].p;
        var dist = dq * dq + dp * dp;
        if (dist > bd) { bd = dist; best = [cand[i], cand[j]]; }
      }
    }
    if (!best || bd < 1e-9) { return null; }
    /* order by q ascending for stable labeling */
    var A = best[0], B = best[1];
    if (A.q > B.q) { var t = A; A = B; B = t; }
    return { q1: A.q, p1: A.p, q2: B.q, p2: B.p };
  }

  /* Dashed guides from (q,p) to BOTH axes, plus the value written on each axis.
     The guides are darker than the grid so the eye follows them to the number.
     A label is registered rather than drawn here, so it lands on top of the
     curves; pass qlab/plab false to leave an axis unlabelled (a question whose
     answer IS that number), in which case the grid is what the student reads. */
  function markPoint(P, q, p, opts) {
    opts = opts || {};
    var s = "";
    s += line(P.X(q), P.Y(p), P.X(q), P.y0, C.guide, 1.2, "5 3");
    s += line(P.X(q), P.Y(p), P.x0, P.Y(p), C.guide, 1.2, "5 3");
    s += "<circle cx='" + P.X(q) + "' cy='" + P.Y(p) + "' r='3.5' fill='" + C.ink + "'/>";
    /* A number goes on the axis. A symbol like Q* is the NAME of the answer,
       not the answer, so it is written beside the point instead — blanking the
       gridline number there would take away the very thing being read. */
    var sym = [];
    if (opts.qlab !== false) {
      if (isNumericLabel(opts.qlab, q)) { P.extraX.push({ v: q, text: (opts.qlab || fmt(q)) }); }
      else { sym.push(opts.qlab); P.mustX.push(q); }
    } else { P.mustX.push(q); }
    if (opts.plab !== false) {
      if (isNumericLabel(opts.plab, p)) { P.extraY.push({ v: p, text: (opts.plab || fmt(p)) }); }
      else { sym.push(opts.plab); P.mustY.push(p); }
    } else { P.mustY.push(p); }
    if (sym.length) {
      s += txt(P.X(q) + 7, P.Y(p) - 7, sym.join(", "), { fill: C.ink, size: 11, weight: 700 });
    }
    return s;
  }

  /* Axis numbers, drawn last: every gridline is numbered, and where a marked
     value falls near a gridline its own (bold) number replaces that tick's, so
     the two never print on top of each other. */
  function axisNumbers(P) {
    var s = "", i, j, v, px, py, clash;
    var ex = dedupe(P.extraX, function (a) { return P.X(a.v); }, 1.5);
    var ey = dedupe(P.extraY, function (a) { return P.Y(a.v); }, 1.5);
    for (i = 0; i < (P.ticksX || []).length; i++) {
      v = P.ticksX[i]; px = P.X(v); clash = false;
      for (j = 0; j < ex.length; j++) { if (Math.abs(P.X(ex[j].v) - px) < 19) { clash = true; } }
      if (!clash) { s += txt(px, P.y0 + 15, fmt(v), { anchor: "middle", size: 10.5, fill: C.muted }); }
    }
    for (i = 0; i < (P.ticksY || []).length; i++) {
      v = P.ticksY[i];
      if (v <= 0) { continue; }
      py = P.Y(v); clash = false;
      for (j = 0; j < ey.length; j++) { if (Math.abs(P.Y(ey[j].v) - py) < 11) { clash = true; } }
      if (!clash) { s += txt(P.x0 - 7, py + 3.5, fmt(v), { anchor: "end", size: 10.5, fill: C.muted }); }
    }
    for (i = 0; i < ex.length; i++) {
      if (!isFinite(ex[i].v) || ex[i].v < -1e-9 || ex[i].v > P.qmax + 1e-9) { continue; }
      px = P.X(ex[i].v);
      s += line(px, P.y0, px, P.y0 + 5, C.ink, 1.4);
      s += txt(px, P.y0 + 16, ex[i].text, { anchor: "middle", size: 11, fill: C.ink, weight: 700 });
    }
    for (i = 0; i < ey.length; i++) {
      if (!isFinite(ey[i].v) || ey[i].v < -1e-9 || ey[i].v > P.pmax + 1e-9) { continue; }
      py = P.Y(ey[i].v);
      s += line(P.x0 - 5, py, P.x0, py, C.ink, 1.4);
      s += txt(P.x0 - 7, py + 3.5, ey[i].text, { anchor: "end", size: 11, fill: C.ink, weight: 700 });
    }
    return s;
  }

  /* keep one label per position: two curves can mark the same price */
  function dedupe(list, pos, tol) {
    var out = [], i, j, dup;
    for (i = 0; i < (list || []).length; i++) {
      dup = false;
      for (j = 0; j < out.length; j++) { if (Math.abs(pos(out[j]) - pos(list[i])) < tol) { dup = true; } }
      if (!dup) { out.push(list[i]); }
    }
    return out;
  }
  function fmt(n) { return (Math.round(n * 100) / 100).toString(); }
  function isNumericLabel(lab, v) {
    if (lab === undefined || lab === null) { return true; }
    return /^-?[0-9.,$%\s]+$/.test(String(lab));
  }

  function svgWrap(P, inner, title) {
    if (P.ticksX || P.ticksY) { inner += axisNumbers(P); }
    return "<svg viewBox='0 0 " + P.W + " " + P.H + "' xmlns='http://www.w3.org/2000/svg' " +
      "role='img' aria-label='" + esc(title || "economic diagram") + "' style='max-width:100%;height:auto;'>" +
      "<rect x='0' y='0' width='" + P.W + "' height='" + P.H + "' fill='#ffffff'/>" +
      inner + "</svg>";
  }

  /* ================= diagram builders ================= */

  /* linear supply & demand. spec: {dA,dB (demand p=dA+dB q, dB<0),
     sA,sB (supply), qmax,pmax, showEq, shade:'surplus'|'none'} */
  function supplyDemand(spec) {
    /* equilibrium: dA+dB q = sA+sB q -> q* */
    var qe = (spec.sA - spec.dA) / (spec.dB - spec.sB);
    var pe = spec.dA + spec.dB * qe;
    var P = makePlot({ w: spec.w, h: spec.h, qmax: spec.qmax, pmax: spec.pmax,
                       mustX: [qe], mustY: [pe] });
    var s = axes(P, spec.xlab, spec.ylab);

    if (spec.shade === "surplus" && qe > 0) {
      /* consumer surplus: triangle (0,pe)-(0,dA)-(qe,pe) ; producer: (0,pe)-(0,sA)-(qe,pe) */
      s += poly([[P.X(0), P.Y(pe)], [P.X(0), P.Y(spec.dA)], [P.X(qe), P.Y(pe)]], C.surplus, C.surplusStroke);
      s += poly([[P.X(0), P.Y(pe)], [P.X(0), P.Y(spec.sA)], [P.X(qe), P.Y(pe)]], "#b8740822", C.supply);
      s += txt(P.X(qe * 0.28), P.Y((pe + spec.dA) / 2), "CS", { fill: C.surplusStroke, weight: 700, size: 12 });
      s += txt(P.X(qe * 0.28), P.Y((pe + spec.sA) / 2), "PS", { fill: C.supply, weight: 700, size: 12 });
    }
    /* total-revenue rectangle P* x Q* (for elasticity / revenue questions) */
    if (spec.showRevenueBox && qe > 0) {
      s += "<rect x='" + P.X(0) + "' y='" + P.Y(pe) + "' width='" + (P.X(qe) - P.X(0)) +
        "' height='" + (P.y0 - P.Y(pe)) + "' fill='#0f3d9e14' stroke='#0f3d9e' stroke-dasharray='3 3'/>";
      s += txt(P.X(qe * 0.4), P.Y(pe / 2), "Revenue", { fill: C.demand, weight: 700, size: 11 });
    }
    s += linearCurve(P, spec.dA, spec.dB, C.demand, spec.dLabel || "D");
    s += linearCurve(P, spec.sA, spec.sB, C.supply, spec.sLabel || "S");
    if (spec.showEq !== false && qe > 0 && qe < P.qmax) {
      s += markPoint(P, qe, pe, { qlab: spec.hideValues ? "Q*" : fmt(qe), plab: spec.hideValues ? "P*" : fmt(pe) });
    }
    return svgWrap(P, s, "supply and demand");
  }

  /* a shift. spec: base demand/supply + which:'demand'|'supply', shiftBy (added to intercept) */
  function shiftDiagram(spec) {
    var dA = spec.dA, dB = spec.dB, sA = spec.sA, sB = spec.sB;
    /* original equilibrium */
    var qe1 = (sA - dA) / (dB - sB), pe1 = dA + dB * qe1;
    var dA2 = dA, sA2 = sA;
    if (spec.which === "demand") { dA2 = dA + spec.shiftBy; }
    else { sA2 = sA + spec.shiftBy; }
    var qe2 = (sA2 - dA2) / (dB - sB), pe2 = dA2 + dB * qe2;
    var P = makePlot({ w: spec.w, h: spec.h, qmax: spec.qmax, pmax: spec.pmax,
                       mustX: [qe1, qe2], mustY: [pe1, pe2] });
    var s = axes(P, spec.xlab, spec.ylab);

    /* original curves (lighter) */
    s += linearCurve(P, dA, dB, spec.which === "demand" ? "#0f3d9e88" : C.demand, spec.which === "demand" ? "D\u2081" : "D");
    s += linearCurve(P, sA, sB, spec.which === "supply" ? "#b8740888" : C.supply, spec.which === "supply" ? "S\u2081" : "S");
    /* shifted curve */
    if (spec.which === "demand") { s += linearCurve(P, dA2, dB, C.alt, "D\u2082"); }
    else { s += linearCurve(P, sA2, sB, C.alt, "S\u2082"); }

    if (!spec.hideValues) {
      if (qe1 > 0 && qe1 < P.qmax) { s += markPoint(P, qe1, pe1, { qlab: fmt(qe1), plab: fmt(pe1) }); }
      if (qe2 > 0 && qe2 < P.qmax) { s += markPoint(P, qe2, pe2, { qlab: fmt(qe2), plab: fmt(pe2) }); }
    } else {
      /* the numbers are the answer here, so they are not printed — but the
         guides still run to the axes and every gridline is numbered, so both
         equilibria can be read off rather than guessed at */
      if (qe1 > 0 && qe1 < P.qmax) { s += markPoint(P, qe1, pe1, { qlab: false, plab: false }); }
      if (qe2 > 0 && qe2 < P.qmax) { s += markPoint(P, qe2, pe2, { qlab: false, plab: false }); }
    }
    return svgWrap(P, s, "curve shift");
  }

  /* price control. spec: sd params + control:'ceiling'|'floor', level:p */
  function priceControl(spec) {
    var qe = (spec.sA - spec.dA) / (spec.dB - spec.sB), pe = spec.dA + spec.dB * qe;
    var qdC = (spec.level - spec.dA) / spec.dB, qsC = (spec.level - spec.sA) / spec.sB;
    var P = makePlot({ w: spec.w, h: spec.h, qmax: spec.qmax, pmax: spec.pmax,
                       mustX: [qdC, qsC, qe], mustY: [spec.level, pe] });
    var s = axes(P, spec.xlab, spec.ylab);
    s += linearCurve(P, spec.dA, spec.dB, C.demand, "D");
    s += linearCurve(P, spec.sA, spec.sB, C.supply, "S");
    /* control line */
    var lv = spec.level;
    s += line(P.X(0), P.Y(lv), P.X(P.qmax), P.Y(lv), C.dwlStroke, 2, "6 4");
    s += txt(P.X(P.qmax) - 4, P.Y(lv) - 5, (spec.control === "ceiling" ? "Ceiling" : "Floor"), { anchor: "end", fill: C.dwlStroke, weight: 700, size: 12 });
    /* qd and qs at the controlled price */
    var qd = (lv - spec.dA) / spec.dB;
    var qs = (lv - spec.sA) / spec.sB;
    if (!spec.hideValues) {
      /* the controlled price is given in the question, so it is labelled; the
         two quantities get guides and their values on the quantity axis */
      s += markPoint(P, qd, lv, { plab: fmt(lv), qlab: fmt(qd) });
      s += markPoint(P, qs, lv, { plab: false, qlab: fmt(qs) });
      s += txt(P.X(qd) + 6, P.Y(lv) - 6, "Qd", { fill: C.muted, size: 11, weight: 700 });
      s += txt(P.X(qs) + 6, P.Y(lv) - 6, "Qs", { fill: C.muted, size: 11, weight: 700 });
      /* shortage/surplus bracket along the price line */
      var gapStroke = C.dwlStroke;
      s += line(P.X(Math.min(qd, qs)), P.Y(lv), P.X(Math.max(qd, qs)), P.Y(lv), gapStroke, 3);
      var midq = (qd + qs) / 2;
      var lab = (spec.control === "ceiling") ? "Shortage" : "Surplus";
      s += txt(P.X(midq), P.Y(lv) + 16, lab, { anchor: "middle", fill: gapStroke, weight: 700, size: 11 });
    }
    return svgWrap(P, s, "price control");
  }

  /* per-unit tax wedge. spec: sd params + tax:t (shifts supply up by t) */
  function taxDiagram(spec) {
    var sA2x = spec.sA + spec.tax;
    var qtX = (sA2x - spec.dA) / (spec.dB - spec.sB);
    var pbX = spec.dA + spec.dB * qtX, psX = pbX - spec.tax;
    var qeX = (spec.sA - spec.dA) / (spec.dB - spec.sB), peX = spec.dA + spec.dB * qeX;
    var P = makePlot({ w: spec.w, h: spec.h, qmax: spec.qmax, pmax: spec.pmax,
                       mustX: [qtX, qeX], mustY: [pbX, psX, peX] });
    var s = axes(P, spec.xlab, spec.ylab);
    var sA2 = spec.sA + spec.tax;
    /* new eq with taxed supply */
    var qt = (sA2 - spec.dA) / (spec.dB - spec.sB);
    var pb = spec.dA + spec.dB * qt;         /* price buyers pay */
    var ps = pb - spec.tax;                   /* price sellers get */
    var qe = (spec.sA - spec.dA) / (spec.dB - spec.sB);
    var pe = spec.dA + spec.dB * qe;

    /* DWL triangle: (qt,pb)-(qt,ps)-(qe,pe) */
    if (spec.showDWL !== false && qt < qe) {
      s += poly([[P.X(qt), P.Y(pb)], [P.X(qt), P.Y(ps)], [P.X(qe), P.Y(pe)]], C.dwl, C.dwlStroke);
    }
    /* tax revenue rectangle: from qt left, between ps and pb */
    if (spec.showRevenue) {
      s += "<rect x='" + P.X(0) + "' y='" + P.Y(pb) + "' width='" + (P.X(qt) - P.X(0)) +
        "' height='" + (P.Y(ps) - P.Y(pb)) + "' fill='#16653422' stroke='#166534' stroke-dasharray='3 3'/>";
      s += txt(P.X(qt * 0.4), P.Y((pb + ps) / 2) + 4, "Tax rev", { fill: "#166534", size: 11, weight: 700 });
    }
    s += linearCurve(P, spec.dA, spec.dB, C.demand, "D");
    s += linearCurve(P, spec.sA, spec.sB, C.supply, "S");
    s += linearCurve(P, sA2, spec.sB, C.alt, "S+tax");
    if (!spec.hideValues) {
      s += markPoint(P, qt, pb, { qlab: fmt(qt), plab: fmt(pb) });
      s += markPoint(P, qt, ps, { qlab: false, plab: fmt(ps) });
      /* the no-tax equilibrium: half of every tax question compares with it */
      if (qe > 0 && qe < P.qmax) { s += markPoint(P, qe, pe, { qlab: fmt(qe), plab: fmt(pe) }); }
    }
    return svgWrap(P, s, "tax wedge");
  }

  /* single elasticity curve annotated. spec: {a,b,steep(bool)} */
  function elasticity(spec) {
    var mq0 = (spec.qmax || 10) * 0.5, mp0 = spec.a + spec.b * mq0;
    var P = makePlot({ w: spec.w, h: spec.h, qmax: spec.qmax, pmax: spec.pmax,
                       mustX: [mq0], mustY: [mp0] });
    var s = axes(P, spec.xlab, spec.ylab);
    s += linearCurve(P, spec.a, spec.b, C.demand, spec.label || "D");
    /* a mid point, with its price and quantity readable on the axes */
    var mq = P.qmax * 0.5, mp = spec.a + spec.b * mq;
    s += markPoint(P, mq, mp, { qlab: fmt(mq), plab: fmt(mp) });
    return svgWrap(P, s, "elasticity");
  }

  /* generic labeled linear curve (MC/ATC later). spec:{a,b,color,label} */
  function curve(spec) {
    var P = makePlot(spec);
    var s = axes(P, spec.xlab || "Quantity", spec.ylab || "Cost");
    s += linearCurve(P, spec.a, spec.b, spec.color || C.supply, spec.label || "");
    return svgWrap(P, s, "curve");
  }

  /* production possibilities frontier. spec:{ xmax, ymax, xlab, ylab,
     bow (0=linear, 0.3 typical concave), points:[{x,y,label,state}] }
     A concave (bowed-out) frontier via a quadratic-ish arc between the two
     axis intercepts (xmax on x-axis, ymax on y-axis). points can be marked
     'inside'(inefficient), 'on'(efficient), 'outside'(unattainable). */
  function ppf(spec) {
    var mustPX = [], mustPY = [], pi;
    for (pi = 0; pi < (spec.points || []).length; pi++) {
      mustPX.push(spec.points[pi].x); mustPY.push(spec.points[pi].y);
    }
    var P = makePlot({ w: spec.w, h: spec.h, qmax: spec.xmax || 10, pmax: spec.ymax || 10,
                       mustX: mustPX, mustY: mustPY });
    var s = axes(P, spec.xlab || "Good X", spec.ylab || "Good Y");
    var bow = (spec.bow != null) ? spec.bow : 0.28;   /* 0 = straight line */
    /* build the frontier as a polyline from (0,ymax) to (xmax,0), bowed out.
       param t in [0,1]: x = t*xmax ; straight y = (1-t)*ymax ; add outward bulge. */
    var xmax = spec.xmax || 10, ymax = spec.ymax || 10;
    var pts = [];
    var N = 40;
    for (var i = 0; i <= N; i++) {
      var t = i / N;
      var x = t * xmax;
      var yStraight = (1 - t) * ymax;
      /* outward bulge peaks at the middle, zero at endpoints */
      var bulge = bow * ymax * Math.sin(Math.PI * t) * 0.9;
      var y = yStraight + bulge;
      if (y > ymax) { y = ymax; }
      pts.push(P.X(x) + "," + P.Y(y));
    }
    s += "<polyline points='" + pts.join(" ") + "' fill='none' stroke='" + C.demand +
      "' stroke-width='2.5' />";
    s += txt(P.X(xmax * 0.62), P.Y(ymax * 0.62), spec.frontierLabel || "PPF",
      { fill: C.demand, weight: 700, size: 13 });
    /* mark points */
    if (spec.points) {
      spec.points.forEach(function (pt) {
        var col = pt.state === "outside" ? C.dwlStroke : pt.state === "inside" ? C.muted : C.supply;
        /* guides to both axes: these questions are about the combination of
           goods at the point, which has to be readable without counting pixels */
        s += line(P.X(pt.x), P.Y(pt.y), P.X(pt.x), P.y0, C.guide, 1.2, "5 3");
        s += line(P.X(pt.x), P.Y(pt.y), P.x0, P.Y(pt.y), C.guide, 1.2, "5 3");
        s += "<circle cx='" + P.X(pt.x) + "' cy='" + P.Y(pt.y) + "' r='4' fill='" + col + "'/>";
        if (pt.label) {
          s += txt(P.X(pt.x) + 7, P.Y(pt.y) - 5, pt.label, { fill: col, weight: 700, size: 12 });
        }
        P.extraX.push({ v: pt.x, text: fmt(pt.x) });
        P.extraY.push({ v: pt.y, text: fmt(pt.y) });
      });
    }
    return svgWrap(P, s, "production possibilities frontier");
  }

  /* cost curves: U-shaped ATC/AVC and rising MC that crosses each at its min.
     spec:{ qmax, cmax, mc:{a,b} (MC = a + b*q linear rising), showATC, showAVC,
     price (optional horizontal line), markMin } . We derive ATC from a simple
     convex cost model so MC intersects ATC at ATC's minimum (a known result). */
  function costCurves(spec) {
    var P = makePlot({ w: spec.w, h: spec.h, qmax: spec.qmax || 12, pmax: spec.cmax || 24,
                       mustY: (spec.price != null ? [spec.price] : []) });
    var s = axes(P, spec.xlab || "Quantity", spec.ylab || "Cost / Price");
    /* Cubic total-cost model gives U-shaped MC, AVC, ATC (textbook shape):
         VC(q) = a*q - b*q^2 + c*q^3   (variable cost)
         TC(q) = FC + VC(q)
         MC(q) = a - 2b*q + 3c*q^2        (U-shaped)
         AVC(q) = a - b*q + c*q^2         (U-shaped)
         ATC(q) = FC/q + a - b*q + c*q^2  (U-shaped)
       Choose a,b,c so the curves dip then rise within the box. */
    var FC = (spec.fc != null) ? spec.fc : 24;
    var a = (spec.a != null) ? spec.a : 10;
    var b = (spec.b != null) ? spec.b : 2.2;
    var c = (spec.c != null) ? spec.c : 0.18;
    function MC(q) { return a - 2 * b * q + 3 * c * q * q; }
    function AVC(q) { return a - b * q + c * q * q; }
    function ATC(q) { return FC / q + a - b * q + c * q * q; }
    function plot(fn, stroke, label, qStart) {
      var pts = [];
      var q0 = qStart || 0.5;
      var lastInsideQ = null, lastInsideV = null;
      for (var q = q0; q <= P.qmax + 0.0001; q += P.qmax / 120) {
        var v = fn(q);
        if (v <= P.pmax && v >= 0) {
          pts.push(P.X(q) + "," + P.Y(v));
          lastInsideQ = q; lastInsideV = v;
        }
      }
      if (pts.length < 2) { return ""; }
      var out = "<polyline points='" + pts.join(" ") + "' fill='none' stroke='" + stroke + "' stroke-width='2.5' />";
      /* label near a point that's inside the box; keep it clear of the right edge
         so multi-character labels (ATC/AVC) don't get clipped by the viewBox */
      if (lastInsideQ != null) {
        var lx = P.X(lastInsideQ) + 4;
        var rightEdge = P.X(P.qmax);
        if (lx > rightEdge - 26) {
          /* too close to the edge: right-anchor the label just inside the plot */
          out += txt(rightEdge - 4, P.Y(lastInsideV) - 2, label, { fill: stroke, weight: 700, size: 12, anchor: "end" });
        } else {
          out += txt(lx, P.Y(lastInsideV) - 2, label, { fill: stroke, weight: 700, size: 12 });
        }
      }
      return out;
    }
    /* draw order: AVC and ATC (blue/gold), then MC (red) on top */
    if (spec.showAVC) { s += plot(AVC, C.supply, "AVC", 0.5); }
    if (spec.showATC !== false) { s += plot(ATC, C.demand, "ATC", 0.9); }
    s += plot(MC, C.dwlStroke, "MC", 0.5);

    /* mark the ATC minimum (where MC crosses ATC) by scanning numerically */
    if (spec.markMin !== false) {
      var qMinAtc = null, best = Infinity;
      for (var qq = 1; qq <= P.qmax; qq += 0.02) {
        var val = ATC(qq);
        if (val < best) { best = val; qMinAtc = qq; }
      }
      if (qMinAtc != null && best <= P.pmax) {
        /* "MC crosses ATC at its minimum" is only visible if that output can be
           read off the quantity axis */
        s += markPoint(P, qMinAtc, best, { qlab: fmt(Math.round(qMinAtc * 10) / 10), plab: fmt(Math.round(best * 10) / 10) });
        s += txt(P.X(qMinAtc) + 7, P.Y(best) - 6, "min ATC", { fill: C.ink, size: 10.5, weight: 700 });
      }
    }
    /* optional price line + profit/loss rectangle (competitive-firm questions).
       At the profit-max quantity q* where P = MC, shade the rectangle between
       price and ATC(q*): green if profit (P>ATC), red if loss (P<ATC). */
    if (spec.price != null) {
      var Pr = spec.price;
      s += line(P.X(0), P.Y(Pr), P.X(P.qmax), P.Y(Pr), C.guide, 1.5, "5 4");
      s += txt(P.X(P.qmax) - 4, P.Y(Pr) - 5, "P = MR", { anchor: "end", fill: C.muted, weight: 700, size: 12 });
      P.extraY.push({ v: Pr, text: fmt(Pr) });
      if (spec.showProfit) {
        /* find q* where MC(q) = price, scanning the rising part of MC */
        var qStar = null;
        for (var qs2 = 0.5; qs2 <= P.qmax; qs2 += 0.01) {
          if (MC(qs2) >= Pr) { qStar = qs2; break; }
        }
        if (qStar != null && qStar > 0 && qStar < P.qmax) {
          var atcStar = ATC(qStar);
          var isProfit = Pr >= atcStar;
          var fill = isProfit ? "#16653433" : "#991b1b33";
          var stroke = isProfit ? C.surplusStroke : C.dwlStroke;
          var yTop = Math.min(P.Y(Pr), P.Y(atcStar));
          var yBot = Math.max(P.Y(Pr), P.Y(atcStar));
          s += "<rect x='" + P.X(0) + "' y='" + yTop + "' width='" + (P.X(qStar) - P.X(0)) +
            "' height='" + (yBot - yTop) + "' fill='" + fill + "' stroke='" + stroke + "' stroke-dasharray='3 3'/>";
          s += txt(P.X(qStar * 0.42), (yTop + yBot) / 2 + 4, isProfit ? "Profit" : "Loss",
            { fill: stroke, weight: 700, size: 11 });
          /* q* where P = MC, with its value on the quantity axis */
          s += line(P.X(qStar), P.Y(Pr), P.X(qStar), P.y0, C.guide, 1.2, "5 3");
          s += txt(P.X(qStar) + 6, P.Y(Pr) + 14, "q*", { fill: C.ink, size: 11, weight: 700 });
          P.extraX.push({ v: qStar, text: fmt(Math.round(qStar * 10) / 10) });
        }
      }
    }
    return svgWrap(P, s, "cost curves");
  }

  /* monopoly: demand P=a-b*Q, MR=a-2b*Q, MC (constant mc0 or rising mc0+mcSlope*Q),
     optional ATC for profit, mark Qm (MR=MC), monopoly price Pm on demand, the
     competitive point (MC=demand), profit rectangle, and deadweight-loss triangle. */
  function monopoly(spec) {
    var a = spec.a, b = spec.b;                 /* demand intercept & slope magnitude */
    var mc0 = (spec.mc0 != null) ? spec.mc0 : 2;
    var mcSlope = (spec.mcSlope != null) ? spec.mcSlope : 0;
    function D(q) { return a - b * q; }
    function MR(q) { return a - 2 * b * q; }
    function MC(q) { return mc0 + mcSlope * q; }
    /* Qm where MR=MC: a-2b*q = mc0+mcSlope*q -> q=(a-mc0)/(2b+mcSlope) */
    var qm = (a - mc0) / (2 * b + mcSlope);
    var pm = D(qm);
    var mcm = MC(qm);
    /* competitive q where D=MC: a-b*q = mc0+mcSlope*q -> q=(a-mc0)/(b+mcSlope) */
    var qc = (a - mc0) / (b + mcSlope);
    var pc = MC(qc);
    var P = makePlot({ w: spec.w, h: spec.h, qmax: spec.qmax || (qc * 1.25), pmax: spec.pmax || (a * 1.1),
                       mustX: [qm, qc], mustY: [pm, mcm] });
    var s = axes(P, spec.xlab || "Quantity", spec.ylab || "Price");
    /* profit rectangle (Pm - ATC(qm)) x qm, if ATC provided */
    if (spec.showProfit && spec.atc != null) {
      var atcm = spec.atc;                       /* caller supplies ATC at qm for a clean number */
      var isProfit = pm >= atcm;
      var fill = isProfit ? "#16653433" : "#991b1b33";
      var stroke = isProfit ? C.surplusStroke : C.dwlStroke;
      var yTop = Math.min(P.Y(pm), P.Y(atcm)), yBot = Math.max(P.Y(pm), P.Y(atcm));
      s += "<rect x='" + P.X(0) + "' y='" + yTop + "' width='" + (P.X(qm) - P.X(0)) +
        "' height='" + (yBot - yTop) + "' fill='" + fill + "' stroke='" + stroke + "' stroke-dasharray='3 3'/>";
      s += txt(P.X(qm * 0.4), (yTop + yBot) / 2 + 4, isProfit ? "Profit" : "Loss", { fill: stroke, weight: 700, size: 11 });
    }
    /* deadweight loss triangle between qm and qc (bounded by demand above, MC below) */
    if (spec.showDWL) {
      s += poly([[P.X(qm), P.Y(pm)], [P.X(qm), P.Y(mcm)], [P.X(qc), P.Y(pc)]], C.dwl, C.dwlStroke);
      s += txt(P.X((qm + qc) / 2 + 0.1), P.Y((pm + pc) / 2), "DWL", { fill: C.dwlStroke, weight: 700, size: 10 });
    }
    /* curves */
    s += linearCurve(P, a, -b, C.demand, "D", qc * 1.05);
    s += linearCurve(P, a, -2 * b, C.alt, "MR", qm * 0.85);
    if (mcSlope === 0) {
      s += line(P.X(0), P.Y(mc0), P.X(P.qmax), P.Y(mc0), C.supply, 2.5);
      s += txt(P.X(P.qmax) - 4, P.Y(mc0) - 5, "MC", { anchor: "end", fill: C.supply, weight: 700, size: 12 });
    } else {
      s += linearCurve(P, mc0, mcSlope, C.supply, "MC", qc * 0.9);
    }
    /* mark monopoly point: Qm on axis, Pm on demand */
    s += markPoint(P, qm, pm, { qlab: fmt(Math.round(qm * 100) / 100), plab: fmt(Math.round(pm * 100) / 100) });
    s += txt(P.X(qm) + 7, P.Y(pm) - 6, "Qm, Pm", { fill: C.ink, size: 10.5, weight: 700 });
    /* optionally mark competitive point */
    if (spec.showCompetitive) {
      s += line(P.X(qc), P.Y(pc), P.X(qc), P.y0, C.guide, 1.2, "5 3");
      s += "<circle cx='" + P.X(qc) + "' cy='" + P.Y(pc) + "' r='3' fill='" + C.surplusStroke + "'/>";
      s += txt(P.X(qc) + 6, P.Y(pc) - 6, "Qc", { fill: C.surplusStroke, size: 11, weight: 700 });
      P.extraX.push({ v: qc, text: fmt(Math.round(qc * 100) / 100) });
    }
    return svgWrap(P, s, "monopoly");
  }

  /* payoff_matrix: a 2x2 game matrix. Rows = Player A's strategies, columns =
     Player B's strategies. Each cell shows the payoff pair (A, B) with A's payoff
     in navy and B's in gold. Spec:
       playerA, playerB: names (default "Firm A"/"Firm B")
       stratA: [rowLabel0, rowLabel1], stratB: [colLabel0, colLabel1]
       cells: [[ [a,b], [a,b] ], [ [a,b], [a,b] ]]  // cells[row][col] = [A payoff, B payoff]
       highlight: [row,col] to shade a cell (e.g., the Nash equilibrium), optional
       highlightLabel: text placed under the highlighted cell, optional */
  function payoffMatrix(spec) {
    var W = spec.w || 460, H = spec.h || 340;
    var pA = spec.playerA || "Firm A", pB = spec.playerB || "Firm B";
    var sA = spec.stratA || ["Strategy 1", "Strategy 2"];
    var sB = spec.stratB || ["Strategy 1", "Strategy 2"];
    var cells = spec.cells;
    /* layout: leave margins for player labels and strategy labels */
    var left = 96, top = 70;                      /* where the 2x2 grid starts */
    var cw = (W - left - 20) / 2;                 /* cell width */
    var chh = (H - top - 30) / 2;                 /* cell height */
    var s = "<rect x='0' y='0' width='" + W + "' height='" + H + "' fill='#ffffff'/>";
    /* Player B header (top, spanning the two columns) */
    s += txt(left + cw, 22, pB + " chooses:", { anchor: "middle", fill: C.supply, weight: 700, size: 13 });
    /* Player B strategy labels (column headers) */
    s += txt(left + cw / 2, 52, sB[0], { anchor: "middle", fill: C.ink, weight: 600, size: 12 });
    s += txt(left + cw + cw / 2, 52, sB[1], { anchor: "middle", fill: C.ink, weight: 600, size: 12 });
    /* Player A header (left, rotated) */
    s += "<text x='22' y='" + (top + chh) + "' fill='" + C.demand + "' font-family='Inter, system-ui, sans-serif' font-size='13' font-weight='700' text-anchor='middle' transform='rotate(-90 22 " + (top + chh) + ")'>" + esc(pA + " chooses:") + "</text>";
    /* Player A strategy labels (row headers) */
    s += txt(left - 8, top + chh / 2 + 4, sA[0], { anchor: "end", fill: C.ink, weight: 600, size: 12 });
    s += txt(left - 8, top + chh + chh / 2 + 4, sA[1], { anchor: "end", fill: C.ink, weight: 600, size: 12 });
    /* draw the 4 cells */
    for (var r = 0; r < 2; r++) {
      for (var c = 0; c < 2; c++) {
        var cx = left + c * cw, cy = top + r * chh;
        var isHi = spec.highlight && spec.highlight[0] === r && spec.highlight[1] === c;
        s += "<rect x='" + cx + "' y='" + cy + "' width='" + cw + "' height='" + chh + "' fill='" +
          (isHi ? "#7c3aed18" : "#f8fafc") + "' stroke='" + (isHi ? C.alt : "#cbd5e1") + "' stroke-width='" + (isHi ? 2.5 : 1) + "'/>";
        var pair = cells[r][c];
        /* A's payoff (navy, left) and B's payoff (gold, right) */
        s += txt(cx + cw / 2, cy + chh / 2 + 6, "", {});
        s += txt(cx + cw / 2 - 18, cy + chh / 2 + 6, String(pair[0]), { anchor: "middle", fill: C.demand, weight: 700, size: 18 });
        s += txt(cx + cw / 2, cy + chh / 2 + 6, ",", { anchor: "middle", fill: C.muted, size: 16 });
        s += txt(cx + cw / 2 + 18, cy + chh / 2 + 6, String(pair[1]), { anchor: "middle", fill: C.supply, weight: 700, size: 18 });
        if (isHi && spec.highlightLabel) {
          s += txt(cx + cw / 2, cy + chh - 8, spec.highlightLabel, { anchor: "middle", fill: C.alt, weight: 700, size: 10 });
        }
      }
    }
    /* legend: which color is which player's payoff */
    s += txt(left, H - 10, pA + "'s payoff", { fill: C.demand, weight: 600, size: 11 });
    s += txt(left + cw + 10, H - 10, pB + "'s payoff", { fill: C.supply, weight: 600, size: 11 });
    return "<svg viewBox='0 0 " + W + " " + H + "' xmlns='http://www.w3.org/2000/svg' role='img' aria-label='payoff matrix' style='max-width:100%;height:auto;'>" + s + "</svg>";
  }


  /* ---------------------------------------------------------------------
     'trade' — open-economy supply & demand.
     spec: { dA,dB, sA,sB,            domestic demand/supply  p = A + B*q
             pw,                      world price (horizontal line)
             tariff,                  optional per-unit tariff  (price = pw+tariff)
             quota,                   optional import cap in units
             showTotalSupply,         draw domestic supply shifted right by quota
             shade: 'dwl'|'none',     the two distortion triangles
             showTransfer,            revenue (tariff) or rent (quota) rectangle
             transferLabel,           text inside that rectangle
             qmax,pmax }
     Either tariff or quota may be given, not both. With neither, the diagram
     is free trade at the world price.
     Quota price solves  qd(p) - qs(p) = quota, so the cap exactly binds.
     --------------------------------------------------------------------- */
  function tradeDiagram(spec) {
    var dA = spec.dA, dB = spec.dB, sA = spec.sA, sB = spec.sB;
    var pw = spec.pw;
    var pdPre = pw + (spec.tariff || 0);
    var P = makePlot({ qmax: spec.qmax || 100, pmax: spec.pmax || 10, w: spec.w, h: spec.h,
                       mustX: [(pw - sA) / sB, (pw - dA) / dB, (pdPre - sA) / sB, (pdPre - dA) / dB],
                       mustY: [pw, pdPre] });

    function qd(p) { return (p - dA) / dB; }
    function qs(p) { return (p - sA) / sB; }

    /* autarky, for reference */
    var qAut = (sA - dA) / (dB - sB);
    var pAut = dA + dB * qAut;

    /* domestic price after the policy */
    var pd = pw;
    if (spec.tariff) {
      pd = pw + spec.tariff;
    } else if (spec.quota != null) {
      var denom = (1 / dB) - (1 / sB);
      pd = (spec.quota + (dA / dB) - (sA / sB)) / denom;
    }
    /* a cap looser than free-trade volume does not bind */
    if (spec.quota != null && pd < pw) { pd = pw; }

    var qsW = qs(pw), qdW = qd(pw);
    var qsD = qs(pd), qdD = qd(pd);

    var s = axes(P, spec.xlab || "Quantity", spec.ylab || "Price ($)");

    /* shaded areas go under the curves */
    if (spec.showTransfer !== false && pd > pw + 1e-9) {
      s += poly([[P.X(qsD), P.Y(pw)], [P.X(qsD), P.Y(pd)],
                 [P.X(qdD), P.Y(pd)], [P.X(qdD), P.Y(pw)]], "#1d4ed822", "#1d4ed8");
      s += txt(P.X((qsD + qdD) / 2), P.Y((pw + pd) / 2) + 4,
               spec.transferLabel || (spec.quota != null ? "rents" : "revenue"),
               { anchor: "middle", fill: "#1d4ed8", weight: 700, size: 11 });
    }
    if (spec.shade === "dwl" && pd > pw + 1e-9) {
      /* production distortion: between supply and the world price, qsW..qsD */
      s += poly([[P.X(qsW), P.Y(pw)], [P.X(qsD), P.Y(pd)], [P.X(qsD), P.Y(pw)]], C.dwl, C.dwlStroke);
      /* consumption distortion: between demand and the world price, qdD..qdW */
      s += poly([[P.X(qdD), P.Y(pw)], [P.X(qdD), P.Y(pd)], [P.X(qdW), P.Y(pw)]], C.dwl, C.dwlStroke);
    }

    /* total supply = domestic supply + quota, above the world price */
    if (spec.quota != null && spec.showTotalSupply) {
      var qTop = qs(P.pmax) + spec.quota;
      if (qTop > P.qmax) { qTop = P.qmax; }
      var pTop = sA + sB * (qTop - spec.quota);
      s += "<polyline points='" +
           P.X(0) + "," + P.Y(sA) + " " +
           P.X(qsW) + "," + P.Y(pw) + " " +
           P.X(qsW + spec.quota) + "," + P.Y(pw) + " " +
           P.X(qTop) + "," + P.Y(pTop) +
           "' fill='none' stroke='" + C.alt + "' stroke-width='2.5'/>";
      s += txt(P.X(qTop) - 4, P.Y(pTop) - 6, "S + quota", { anchor: "end", fill: C.alt, weight: 700, size: 12 });
    }

    /* curves last so they sit above the fills */
    s += linearCurve(P, dA, dB, C.demand, spec.dLabel || "D");
    s += linearCurve(P, sA, sB, C.supply, spec.sLabel || "S", spec.quota != null ? qsW * 0.5 : null);

    /* world price line */
    s += line(P.X(0), P.Y(pw), P.X(P.qmax), P.Y(pw), C.surplusStroke, 1.5, "6 4");
    s += txt(P.X(P.qmax) - 4, P.Y(pw) - 6, "P world = " + fmt(pw),
             { anchor: "end", fill: C.surplusStroke, weight: 700, size: 11 });

    /* domestic price line, when a policy has moved it */
    if (pd > pw + 1e-9) {
      s += line(P.X(0), P.Y(pd), P.X(P.qmax), P.Y(pd), C.dwlStroke, 1.5);
      s += txt(P.X(P.qmax) - 4, P.Y(pd) - 6, "P domestic = " + fmt(pd),
               { anchor: "end", fill: C.dwlStroke, weight: 700, size: 11 });
    }

    /* the two domestic quantities at the ruling price */
    s += markPoint(P, qsD, pd, { qlab: fmt(qsD), plab: fmt(pd) });
    s += markPoint(P, qdD, pd, { qlab: fmt(qdD), plab: false });

    /* the trade gap, drawn along the ruling price */
    var gap = qdD - qsD;
    if (Math.abs(gap) > 1e-9) {
      var midQ = (qsD + qdD) / 2;
      s += line(P.X(qsD), P.Y(pd), P.X(qdD), P.Y(pd), C.ink, 3);
      s += txt(P.X(midQ), P.Y(pd) - 10,
               (gap > 0 ? "imports " : "exports ") + fmt(Math.abs(gap)),
               { anchor: "middle", fill: C.ink, weight: 700, size: 12 });
    }

    if (spec.showAutarky) {
      s += "<circle cx='" + P.X(qAut) + "' cy='" + P.Y(pAut) + "' r='3.5' fill='" + C.muted + "'/>";
      s += txt(P.X(qAut) + 6, P.Y(pAut) - 6, "autarky", { fill: C.muted, size: 11, weight: 600 });
    }

    return svgWrap(P, s, "open economy with world price");
  }

  function renderDiagram(spec) {
    if (!spec || !spec.type) { return ""; }
    switch (spec.type) {
      case "supply_demand": return supplyDemand(spec);
      case "shift":         return shiftDiagram(spec);
      case "price_control": return priceControl(spec);
      case "tax":           return taxDiagram(spec);
      case "elasticity":    return elasticity(spec);
      case "curve":         return curve(spec);
      case "ppf":           return ppf(spec);
      case "cost_curves":   return costCurves(spec);
      case "monopoly":      return monopoly(spec);
      case "payoff_matrix":  return payoffMatrix(spec);
      case "trade":         return tradeDiagram(spec);
      default: return "";
    }
  }

  /* exact frontier y for a given x, matching the drawn bowed curve above */
  function ppfY(spec, x) {
    var xmax = spec.xmax || 10, ymax = spec.ymax || 10;
    var bow = (spec.bow != null) ? spec.bow : 0.28;
    var t = x / xmax;
    var y = (1 - t) * ymax + bow * ymax * Math.sin(Math.PI * t) * 0.9;
    if (y > ymax) { y = ymax; }
    return y;
  }

  global.IMDiagrams = { render: renderDiagram, ppfY: ppfY };
})(this);
