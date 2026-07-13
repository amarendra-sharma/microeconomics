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
    grid:   "#e2e8f0",
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
    var W = opts.w || 420, H = opts.h || 320;
    var m = { l: 46, r: 18, t: 18, b: 42 };
    var qmax = opts.qmax || 10, pmax = opts.pmax || 10;
    var x0 = m.l, x1 = W - m.r, y0 = H - m.b, y1 = m.t;
    function X(q) { return x0 + (q / qmax) * (x1 - x0); }
    function Y(p) { return y0 - (p / pmax) * (y0 - y1); }
    return { W: W, H: H, m: m, qmax: qmax, pmax: pmax, X: X, Y: Y, x0: x0, x1: x1, y0: y0, y1: y1 };
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

  /* axes with arrowheads + titles */
  function axes(P, xlab, ylab) {
    var s = "";
    s += line(P.x0, P.y0, P.x1, P.y0, C.axis, 1.5);          /* x axis */
    s += line(P.x0, P.y0, P.x0, P.y1, C.axis, 1.5);          /* y axis */
    /* arrowheads */
    s += "<polygon points='" + P.x1 + "," + P.y0 + " " + (P.x1 - 6) + "," + (P.y0 - 4) + " " + (P.x1 - 6) + "," + (P.y0 + 4) + "' fill='" + C.axis + "'/>";
    s += "<polygon points='" + P.x0 + "," + P.y1 + " " + (P.x0 - 4) + "," + (P.y1 + 6) + " " + (P.x0 + 4) + "," + (P.y1 + 6) + "' fill='" + C.axis + "'/>";
    s += txt(P.x1, P.y0 + 26, xlab || "Quantity", { anchor: "end", fill: C.muted, size: 12, weight: 600 });
    s += txt(P.x0 - 30, P.y1 + 4, ylab || "Price", { fill: C.muted, size: 12, weight: 600 });
    return s;
  }

  /* draw a linear curve p = a + b*q  (b>0 supply, b<0 demand), clipped to box */
  function linearCurve(P, a, b, stroke, labelTxt, labelAtQ) {
    /* find endpoints within [0,qmax] and [0,pmax] */
    var q1 = 0, p1 = a + b * 0;
    var q2 = P.qmax, p2 = a + b * P.qmax;
    var s = line(P.X(q1), P.Y(clampP(P, p1)), P.X(q2), P.Y(clampP(P, p2)), stroke, 2.5);
    if (labelTxt) {
      var lq = (labelAtQ != null) ? labelAtQ : P.qmax * 0.82;
      var lp = a + b * lq;
      s += txt(P.X(lq) + 6, P.Y(clampP(P, lp)) - 4, labelTxt, { fill: stroke, weight: 700, size: 13 });
    }
    return s;
  }
  function clampP(P, p) { return Math.max(0, Math.min(P.pmax, p)); }

  /* dashed drop-lines from an (q,p) point to both axes + tick labels */
  function markPoint(P, q, p, opts) {
    opts = opts || {};
    var s = "";
    s += line(P.X(q), P.Y(p), P.X(q), P.y0, C.muted, 1, "4 3");
    s += line(P.X(q), P.Y(p), P.x0, P.Y(p), C.muted, 1, "4 3");
    s += "<circle cx='" + P.X(q) + "' cy='" + P.Y(p) + "' r='3.5' fill='" + C.ink + "'/>";
    if (opts.qlab !== false) { s += txt(P.X(q), P.y0 + 14, opts.qlab || fmt(q), { anchor: "middle", size: 11, fill: C.muted }); }
    if (opts.plab !== false) { s += txt(P.x0 - 6, P.Y(p) + 4, opts.plab || fmt(p), { anchor: "end", size: 11, fill: C.muted }); }
    return s;
  }
  function fmt(n) { return (Math.round(n * 100) / 100).toString(); }

  function svgWrap(P, inner, title) {
    return "<svg viewBox='0 0 " + P.W + " " + P.H + "' xmlns='http://www.w3.org/2000/svg' " +
      "role='img' aria-label='" + esc(title || "economic diagram") + "' style='max-width:100%;height:auto;'>" +
      "<rect x='0' y='0' width='" + P.W + "' height='" + P.H + "' fill='#ffffff'/>" +
      inner + "</svg>";
  }

  /* ================= diagram builders ================= */

  /* linear supply & demand. spec: {dA,dB (demand p=dA+dB q, dB<0),
     sA,sB (supply), qmax,pmax, showEq, shade:'surplus'|'none'} */
  function supplyDemand(spec) {
    var P = makePlot(spec);
    var s = axes(P, spec.xlab, spec.ylab);
    /* equilibrium: dA+dB q = sA+sB q -> q* */
    var qe = (spec.sA - spec.dA) / (spec.dB - spec.sB);
    var pe = spec.dA + spec.dB * qe;

    if (spec.shade === "surplus" && qe > 0) {
      /* consumer surplus: triangle (0,pe)-(0,dA)-(qe,pe) ; producer: (0,pe)-(0,sA)-(qe,pe) */
      s += poly([[P.X(0), P.Y(pe)], [P.X(0), P.Y(spec.dA)], [P.X(qe), P.Y(pe)]], C.surplus, C.surplusStroke);
      s += poly([[P.X(0), P.Y(pe)], [P.X(0), P.Y(spec.sA)], [P.X(qe), P.Y(pe)]], "#b8740822", C.supply);
      s += txt(P.X(qe * 0.28), P.Y((pe + spec.dA) / 2), "CS", { fill: C.surplusStroke, weight: 700, size: 12 });
      s += txt(P.X(qe * 0.28), P.Y((pe + spec.sA) / 2), "PS", { fill: C.supply, weight: 700, size: 12 });
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
    var P = makePlot(spec);
    var s = axes(P, spec.xlab, spec.ylab);
    var dA = spec.dA, dB = spec.dB, sA = spec.sA, sB = spec.sB;
    /* original equilibrium */
    var qe1 = (sA - dA) / (dB - sB), pe1 = dA + dB * qe1;
    var dA2 = dA, sA2 = sA;
    if (spec.which === "demand") { dA2 = dA + spec.shiftBy; }
    else { sA2 = sA + spec.shiftBy; }
    var qe2 = (sA2 - dA2) / (dB - sB), pe2 = dA2 + dB * qe2;

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
      if (qe1 > 0) { s += "<circle cx='" + P.X(qe1) + "' cy='" + P.Y(pe1) + "' r='3' fill='" + C.ink + "'/>"; }
      if (qe2 > 0) { s += "<circle cx='" + P.X(qe2) + "' cy='" + P.Y(pe2) + "' r='3' fill='" + C.alt + "'/>"; }
    }
    return svgWrap(P, s, "curve shift");
  }

  /* price control. spec: sd params + control:'ceiling'|'floor', level:p */
  function priceControl(spec) {
    var P = makePlot(spec);
    var s = axes(P, spec.xlab, spec.ylab);
    var qe = (spec.sA - spec.dA) / (spec.dB - spec.sB), pe = spec.dA + spec.dB * qe;
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
      s += markPoint(P, qd, lv, { plab: false, qlab: "Qd" });
      s += markPoint(P, qs, lv, { plab: false, qlab: "Qs" });
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
    var P = makePlot(spec);
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
    }
    return svgWrap(P, s, "tax wedge");
  }

  /* single elasticity curve annotated. spec: {a,b,steep(bool)} */
  function elasticity(spec) {
    var P = makePlot(spec);
    var s = axes(P, spec.xlab, spec.ylab);
    s += linearCurve(P, spec.a, spec.b, C.demand, spec.label || "D");
    /* a small %-change indicator around a mid point */
    var mq = P.qmax * 0.5, mp = spec.a + spec.b * mq;
    s += markPoint(P, mq, mp, { qlab: false, plab: false });
    return svgWrap(P, s, "elasticity");
  }

  /* generic labeled linear curve (MC/ATC later). spec:{a,b,color,label} */
  function curve(spec) {
    var P = makePlot(spec);
    var s = axes(P, spec.xlab || "Quantity", spec.ylab || "Cost");
    s += linearCurve(P, spec.a, spec.b, spec.color || C.supply, spec.label || "");
    return svgWrap(P, s, "curve");
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
      default: return "";
    }
  }

  global.IMDiagrams = { render: renderDiagram };
})(this);
