/* ============================================================================
   im-generators.js  —  parameterized question generators for the Intro Micro
   question banks.

   THE CONTRACT (why this file is shared, identical, by BOTH the browser and the
   grading Edge Function):
     * The browser calls generate(genId, seed, cfg) to BUILD a question instance
       to display (prompt text, options, diagram) from a random seed.
     * The Edge Function calls the SAME generate(genId, seed, cfg) with the SAME
       stored seed to recompute the correct answer and grade the submission.
     Because both sides run identical deterministic code on the same seed, the
     student's displayed question and the server's grading always agree, yet the
     correct answer is NEVER sent to the browser.

   DETERMINISM: we use a small seeded PRNG (mulberry32) — NOT Math.random —
   so a given seed always yields the same parameters on every machine.

   Safari-safe: var, function declarations, string concatenation; no template
   literals, optional chaining, or nullish coalescing. Works in a plain browser
   <script> and, with a tiny shim, inside Deno.

   A generator is an object:
     { id, chapter, kind:'numeric'|'mc'|'short', render:'text'|'graphical',
       difficulty:'easy'|'med'|'hard', concept, points,
       build: function(rng, cfg) -> {
         prompt, options?, diagramSpec?, answer, tolerance?, rationale
       } }
   ============================================================================ */
(function (global) {
  "use strict";

  /* ---- seeded PRNG (mulberry32): deterministic, tiny, good enough ------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* helpers on top of the rng */
  function rng_int(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }        /* inclusive */
  function rng_step(rng, lo, hi, step) {
    var n = Math.floor((hi - lo) / step) + 1;
    return Math.round((lo + step * Math.floor(rng() * n)) * 1e6) / 1e6;
  }
  function rng_pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function round2(x) { return Math.round(x * 100) / 100; }

  /* shuffle options deterministically and track where the correct one lands.
     returns { options: shuffledArray, correctIndex } */
  function shuffleWithAnswer(rng, options, correctIdx) {
    var idx = options.map(function (_, i) { return i; });
    for (var i = idx.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
    }
    var shuffled = idx.map(function (k) { return options[k]; });
    var newCorrect = idx.indexOf(correctIdx);
    return { options: shuffled, correctIndex: newCorrect };
  }

  /* ============================ GENERATORS ============================== */
  /* Each build() receives a seeded rng + optional cfg (author range overrides)
     and returns a fully-formed question instance. Keep the economics correct;
     keep numbers "nice" (integer intercepts, integer or 0.5 slopes) so answers
     are clean but not guessable. */

  var GEN = {};

  /* ---- G1: linear equilibrium (numeric) --------------------------------
     Demand P = a - b Q ; Supply P = c + d Q. Solve Q*,P*. Ask for one.
     Ranges chosen so Q* is a clean-ish number. */
  GEN["sd_equilibrium"] = {
    id: "sd_equilibrium", chapter: 4, kind: "numeric", render: "text",
    difficulty: "easy", concept: "market equilibrium", points: 1,
    build: function (rng, cfg) {
      cfg = cfg || {};
      /* pick slopes and intercepts so intersection is tidy */
      var b = rng_pick(rng, [1, 2]);           /* demand slope magnitude */
      var d = rng_pick(rng, [1, 2]);           /* supply slope */
      var qStar = rng_int(rng, 3, 8);          /* choose Q* first, back out intercepts */
      var c = rng_int(rng, 1, 4);              /* supply intercept */
      var pStar = c + d * qStar;               /* equilibrium price */
      var a = pStar + b * qStar;               /* demand intercept so lines meet at (qStar,pStar) */
      var askP = rng() < 0.5;
      var prompt = "In a market, demand is P = " + a + " \u2212 " + b + "Q and supply is P = " +
        c + " + " + d + "Q. " + (askP
          ? "What is the equilibrium price?"
          : "What is the equilibrium quantity?");
      return {
        prompt: prompt,
        answer: askP ? pStar : qStar,
        tolerance: 0.01,
        rationale: "Set " + a + " \u2212 " + b + "Q = " + c + " + " + d +
          "Q \u2192 Q* = " + qStar + ", then P* = " + pStar + "."
      };
    }
  };

  /* ---- G2: equilibrium, GRAPHICAL (numeric, read the graph) -------------
     Same math but the student is shown the diagram (values hidden) and must
     compute Q* or P*. Tests reading + solving, answer not printed. */
  GEN["sd_equilibrium_graph"] = {
    id: "sd_equilibrium_graph", chapter: 4, kind: "numeric", render: "graphical",
    difficulty: "med", concept: "market equilibrium (graph)", points: 2,
    build: function (rng, cfg) {
      var b = rng_pick(rng, [1, 2]);
      var d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 3, 8);
      var c = rng_int(rng, 1, 4);
      var pStar = c + d * qStar;
      var a = pStar + b * qStar;
      var askP = rng() < 0.5;
      /* diagram spec consumed by IMDiagrams.render — hide the numeric values */
      var spec = {
        type: "supply_demand",
        dA: a, dB: -b, sA: c, sB: d,
        qmax: Math.max(10, qStar + 3), pmax: Math.max(12, pStar + 3),
        showEq: true, hideValues: true
      };
      return {
        prompt: "The graph shows a market's supply and demand. Using the curve equations D: P = " +
          a + " \u2212 " + b + "Q and S: P = " + c + " + " + d + "Q, find the equilibrium " +
          (askP ? "price." : "quantity."),
        diagramSpec: spec,
        answer: askP ? pStar : qStar,
        tolerance: 0.01,
        rationale: "Equilibrium where the curves cross: Q* = " + qStar + ", P* = " + pStar + "."
      };
    }
  };

  /* ---- G3: shift direction (MC, conceptual-but-randomized) --------------
     Randomize the shock; correct answer is the direction of price/quantity
     change. Options fixed set, correct index computed. */
  GEN["sd_shift_effect"] = {
    id: "sd_shift_effect", chapter: 4, kind: "mc", render: "text",
    difficulty: "med", concept: "comparative statics", points: 1,
    build: function (rng, cfg) {
      var shocks = [
        { t: "a rise in consumer income (normal good)", curve: "D", dir: +1 },
        { t: "a fall in consumer income (normal good)", curve: "D", dir: -1 },
        { t: "a new tax on producers", curve: "S", dir: -1 },
        { t: "a fall in the price of a key input", curve: "S", dir: +1 },
        { t: "a successful advertising campaign", curve: "D", dir: +1 },
        { t: "the entry of many new firms", curve: "S", dir: +1 }
      ];
      var s = rng_pick(rng, shocks);
      /* effect on P and Q:
         D right(+): P up, Q up ; D left(-): P down, Q down
         S right(+): P down, Q up ; S left(-): P up, Q down */
      var pUp, qUp;
      if (s.curve === "D") { pUp = s.dir > 0; qUp = s.dir > 0; }
      else { pUp = s.dir < 0; qUp = s.dir > 0; }
      var opts = [
        "Price rises, quantity rises",
        "Price rises, quantity falls",
        "Price falls, quantity rises",
        "Price falls, quantity falls"
      ];
      var correct = (pUp && qUp) ? 0 : (pUp && !qUp) ? 1 : (!pUp && qUp) ? 2 : 3;
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "In a competitive market, consider " + s.t +
          ". Holding all else constant, what happens to the equilibrium price and quantity?",
        options: sh.options,
        answer: sh.correctIndex,               /* mc answer = index */
        rationale: "This shifts " + (s.curve === "D" ? "demand" : "supply") +
          " " + (s.dir > 0 ? "right" : "left") + "; trace the new intersection."
      };
    }
  };

  /* ---- G4: consumer surplus at equilibrium (numeric) --------------------
     CS = area of triangle = 0.5 * base(Q*) * height(a - P*). Randomized. */
  GEN["sd_consumer_surplus"] = {
    id: "sd_consumer_surplus", chapter: 7, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "consumer surplus", points: 2,
    build: function (rng, cfg) {
      var b = rng_pick(rng, [1, 2]);
      var d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 3, 7);
      var c = rng_int(rng, 1, 4);
      var pStar = c + d * qStar;
      var a = pStar + b * qStar;
      var cs = 0.5 * qStar * (a - pStar);      /* triangle above price, below demand */
      var spec = {
        type: "supply_demand", dA: a, dB: -b, sA: c, sB: d,
        qmax: Math.max(10, qStar + 3), pmax: Math.max(12, a + 1),
        showEq: true, shade: "surplus", hideValues: false
      };
      return {
        prompt: "Demand is P = " + a + " \u2212 " + b + "Q and supply is P = " + c + " + " + d +
          "Q. Compute the consumer surplus at the competitive equilibrium.",
        diagramSpec: spec,
        answer: round2(cs),
        tolerance: 0.5,
        rationale: "CS = \u00bd \u00d7 Q* \u00d7 (a \u2212 P*) = \u00bd \u00d7 " + qStar + " \u00d7 (" +
          a + " \u2212 " + pStar + ") = " + round2(cs) + "."
      };
    }
  };

  /* helper: format a linear demand/supply expression, dropping a coefficient of 1
     so we get "P = 12 \u2212 Q" not "P = 12 \u2212 1Q". slope sign handled by caller. */
  function fmtCoef(n) { return (n === 1) ? "" : String(n); }

  /* ---- G5: producer surplus (numeric, graphical) ------------------------ */
  GEN["sd_producer_surplus"] = {
    id: "sd_producer_surplus", chapter: 7, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "producer surplus", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]); var d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 3, 7); var c = rng_int(rng, 1, 4);
      var pStar = c + d * qStar; var a = pStar + b * qStar;
      var ps = 0.5 * qStar * (pStar - c);   /* below price, above supply intercept c */
      return {
        prompt: "Demand is P = " + a + " \u2212 " + fmtCoef(b) + "Q and supply is P = " + c +
          " + " + fmtCoef(d) + "Q. Compute the producer surplus at the competitive equilibrium.",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d,
          qmax: Math.max(10, qStar + 3), pmax: Math.max(12, a + 1), showEq: true, shade: "surplus" },
        answer: round2(ps), tolerance: 0.5,
        rationale: "PS = \u00bd \u00d7 Q* \u00d7 (P* \u2212 supply intercept) = \u00bd \u00d7 " + qStar +
          " \u00d7 (" + pStar + " \u2212 " + c + ") = " + round2(ps) + "."
      };
    }
  };

  /* ---- G6: total surplus (numeric) -------------------------------------- */
  GEN["sd_total_surplus"] = {
    id: "sd_total_surplus", chapter: 7, kind: "numeric", render: "text",
    difficulty: "hard", concept: "total surplus", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]); var d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 3, 7); var c = rng_int(rng, 1, 4);
      var pStar = c + d * qStar; var a = pStar + b * qStar;
      var ts = 0.5 * qStar * (a - c);   /* whole triangle between D and S up to Q* */
      return {
        prompt: "Demand is P = " + a + " \u2212 " + fmtCoef(b) + "Q and supply is P = " + c +
          " + " + fmtCoef(d) + "Q. What is the total surplus (consumer + producer) at equilibrium?",
        answer: round2(ts), tolerance: 0.5,
        rationale: "Total surplus = \u00bd \u00d7 Q* \u00d7 (demand intercept \u2212 supply intercept) = \u00bd \u00d7 " +
          qStar + " \u00d7 (" + a + " \u2212 " + c + ") = " + round2(ts) + "."
      };
    }
  };

  /* ---- G7: quantity demanded at a price (easy numeric) ------------------ */
  GEN["sd_qd_at_price"] = {
    id: "sd_qd_at_price", chapter: 4, kind: "numeric", render: "text",
    difficulty: "easy", concept: "reading a demand curve", points: 1,
    build: function (rng) {
      var a = rng_int(rng, 10, 20); var b = rng_pick(rng, [1, 2]);
      /* choose a price that yields an integer quantity in range */
      var qd = rng_int(rng, 2, 7); var price = a - b * qd;
      return {
        prompt: "The demand curve is P = " + a + " \u2212 " + fmtCoef(b) +
          "Q. At a price of " + price + ", what is the quantity demanded?",
        answer: qd, tolerance: 0.01,
        rationale: "Set P = " + price + ": " + price + " = " + a + " \u2212 " + fmtCoef(b) +
          "Q \u2192 Q = " + qd + "."
      };
    }
  };

  /* ---- G8: surplus vs shortage at a given price (MC) -------------------- */
  GEN["sd_surplus_shortage"] = {
    id: "sd_surplus_shortage", chapter: 4, kind: "mc", render: "text",
    difficulty: "med", concept: "disequilibrium", points: 1,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]); var d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 3, 7); var c = rng_int(rng, 1, 4);
      var pStar = c + d * qStar; var a = pStar + b * qStar;
      var above = rng() < 0.5;
      var setP = above ? pStar + rng_int(rng, 1, 3) : pStar - rng_int(rng, 1, 3);
      var opts = ["a surplus (excess supply)", "a shortage (excess demand)",
        "neither \u2014 the market is in equilibrium", "it cannot be determined"];
      var correct = above ? 0 : 1;
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "In this market the equilibrium price is " + pStar + ". If the price is instead set at " +
          setP + ", the result is:",
        options: sh.options, answer: sh.correctIndex,
        rationale: "A price " + (above ? "above" : "below") + " equilibrium creates " +
          (above ? "a surplus (Qs > Qd)." : "a shortage (Qd > Qs).")
      };
    }
  };

  /* ---- G9: demand vs supply determinant (MC conceptual, randomized) ----- */
  GEN["sd_determinant"] = {
    id: "sd_determinant", chapter: 4, kind: "mc", render: "text",
    difficulty: "easy", concept: "determinants of demand/supply", points: 1,
    build: function (rng) {
      var items = [
        { t: "the price of a substitute good rises", ans: "Demand increases (shifts right)" },
        { t: "consumer tastes shift away from the good", ans: "Demand decreases (shifts left)" },
        { t: "the wage paid to workers who make the good falls", ans: "Supply increases (shifts right)" },
        { t: "a new technology makes production more efficient", ans: "Supply increases (shifts right)" },
        { t: "the number of sellers in the market falls", ans: "Supply decreases (shifts left)" },
        { t: "buyers expect the price to be much higher next month", ans: "Demand increases (shifts right)" }
      ];
      var it = rng_pick(rng, items);
      var pool = ["Demand increases (shifts right)", "Demand decreases (shifts left)",
        "Supply increases (shifts right)", "Supply decreases (shifts left)"];
      var correctIdx = pool.indexOf(it.ans);
      var sh = shuffleWithAnswer(rng, pool, correctIdx);
      return {
        prompt: "Other things equal, if " + it.t + ", what happens in this market?",
        options: sh.options, answer: sh.correctIndex,
        rationale: "This is a determinant that shifts the whole curve, not a movement along it."
      };
    }
  };

  /* ---- G10: double shift ambiguity (MC, hard conceptual) ---------------- */
  GEN["sd_double_shift"] = {
    id: "sd_double_shift", chapter: 4, kind: "mc", render: "text",
    difficulty: "hard", concept: "simultaneous shifts", points: 2,
    build: function (rng) {
      /* both curves shift; one of price/quantity is determinate, the other ambiguous */
      var scenarios = [
        { t: "demand rises and supply rises", det: "quantity rises", amb: "price is ambiguous" },
        { t: "demand falls and supply falls", det: "quantity falls", amb: "price is ambiguous" },
        { t: "demand rises and supply falls", det: "price rises", amb: "quantity is ambiguous" },
        { t: "demand falls and supply rises", det: "price falls", amb: "quantity is ambiguous" }
      ];
      var s = rng_pick(rng, scenarios);
      var opts = [
        "Both price and quantity change in determinate directions",
        s.det.charAt(0).toUpperCase() + s.det.slice(1) + ", but " + s.amb,
        "Both price and quantity are ambiguous",
        "Neither price nor quantity changes"
      ];
      var sh = shuffleWithAnswer(rng, opts, 1);
      return {
        prompt: "Suppose " + s.t + " at the same time. What can we say about the new equilibrium?",
        options: sh.options, answer: sh.correctIndex,
        rationale: "When both curves shift, one variable's direction is determinate and the other depends on the relative sizes of the shifts."
      };
    }
  };

  /* ---- G11: equilibrium with a graph, harder fractional (numeric) ------- */
  GEN["sd_equilibrium_price_graph"] = {
    id: "sd_equilibrium_price_graph", chapter: 4, kind: "numeric", render: "graphical",
    difficulty: "med", concept: "equilibrium price (graph)", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]); var d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 3, 8); var c = rng_int(rng, 1, 4);
      var pStar = c + d * qStar; var a = pStar + b * qStar;
      return {
        prompt: "The graph shows demand P = " + a + " \u2212 " + fmtCoef(b) + "Q and supply P = " +
          c + " + " + fmtCoef(d) + "Q. Read off (or compute) the equilibrium price.",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d,
          qmax: Math.max(10, qStar + 3), pmax: Math.max(12, pStar + 3), showEq: true, hideValues: true },
        answer: pStar, tolerance: 0.01,
        rationale: "At equilibrium Q* = " + qStar + ", so P* = " + c + " + " + fmtCoef(d) + "\u00d7" + qStar + " = " + pStar + "."
      };
    }
  };

  /* ===================== CHAPTER 1 — Ten Principles ===================== */

  /* ---- opportunity cost, simple numeric (Ch1) --------------------------- */
  GEN["opp_cost_basic"] = {
    id: "opp_cost_basic", chapter: 1, kind: "numeric", render: "text",
    difficulty: "easy", concept: "opportunity cost", points: 1,
    build: function (rng) {
      var wage = rng_int(rng, 12, 25);
      var hours = rng_int(rng, 2, 5);
      var ticket = rng_int(rng, 20, 60);
      /* opportunity cost of going to an event = ticket price + forgone wages */
      var oc = ticket + wage * hours;
      return {
        prompt: "You could work for $" + wage + " per hour. Instead you spend " + hours +
          " hours at a concert whose ticket costs $" + ticket +
          ". What is the total opportunity cost of attending the concert?",
        answer: oc, tolerance: 0.01,
        rationale: "Opportunity cost = explicit cost ($" + ticket + " ticket) + forgone wages ($" +
          wage + " \u00d7 " + hours + " = $" + (wage * hours) + ") = $" + oc + "."
      };
    }
  };

  /* ---- marginal thinking (Ch1, MC) -------------------------------------- */
  GEN["marginal_decision"] = {
    id: "marginal_decision", chapter: 1, kind: "mc", render: "text",
    difficulty: "med", concept: "marginal thinking", points: 1,
    build: function (rng) {
      var mb = rng_int(rng, 8, 20);
      var mc = rng_int(rng, 8, 20);
      while (mc === mb) { mc = rng_int(rng, 8, 20); }
      var opts = ["Yes \u2014 produce the extra unit", "No \u2014 do not produce the extra unit",
        "It doesn't matter either way", "There isn't enough information"];
      var correct = (mb > mc) ? 0 : 1;
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "A rational firm is deciding whether to produce one more unit. The marginal benefit of that unit is $" +
          mb + " and its marginal cost is $" + mc + ". Should the firm produce it?",
        options: sh.options, answer: sh.correctIndex,
        rationale: "Produce when marginal benefit \u2265 marginal cost. Here MB = $" + mb + ", MC = $" + mc +
          ", so " + (mb > mc ? "produce it." : "do not.")
      };
    }
  };

  /* ===================== CHAPTER 2 — Thinking Like an Economist ========= */

  /* ---- PPF: opportunity cost along the frontier (Ch2, graphical numeric) -- */
  GEN["ppf_opportunity_cost"] = {
    id: "ppf_opportunity_cost", chapter: 2, kind: "numeric", render: "graphical",
    difficulty: "med", concept: "PPF and opportunity cost", points: 2,
    build: function (rng) {
      /* Build a STRAIGHT frontier with a clean integer slope so the two marked
         points lie exactly on the line the renderer draws (which is
         y = ymax*(1 - x/xmax) = ymax - (ymax/xmax)*x when bow=0).
         Choose slope = ymax/xmax as an integer k, and integer x's; then the
         y-values are integers too and sit exactly on the frontier. */
      var k = rng_pick(rng, [1, 2]);          /* opportunity cost of 1 X = k units of Y */
      var xmax = rng_int(rng, 8, 11);         /* x-intercept */
      var ymax = k * xmax;                     /* y-intercept so slope is exactly k */
      var x1 = rng_int(rng, 1, 3);
      var x2 = rng_int(rng, 5, 7);
      var y1 = ymax - k * x1;                  /* exact integer point on frontier */
      var y2 = ymax - k * x2;
      var giveUp = y1 - y2;                     /* = k*(x2-x1) */
      var gain = x2 - x1;
      var oc = round2(giveUp / gain);           /* = k */
      return {
        prompt: "The graph shows a country's production possibilities. Moving from point A (" + x1 + " units of X, " +
          y1 + " of Y) to point B (" + x2 + " of X, " + y2 + " of Y), what is the opportunity cost of ONE additional unit of good X (in units of Y)?",
        diagramSpec: { type: "ppf", xmax: xmax, ymax: ymax, xlab: "Good X", ylab: "Good Y",
          bow: 0, points: [{ x: x1, y: y1, label: "A", state: "on" }, { x: x2, y: y2, label: "B", state: "on" }] },
        answer: oc, tolerance: 0.05,
        rationale: "Opp cost of 1 X = (Y given up)/(X gained) = " + giveUp + "/" + gain + " = " + oc + " units of Y (constant along a straight PPF)."
      };
    }
  };

  /* ---- positive vs normative (Ch2, MC) ---------------------------------- */
  GEN["positive_normative"] = {
    id: "positive_normative", chapter: 2, kind: "mc", render: "text",
    difficulty: "easy", concept: "positive vs normative", points: 1,
    build: function (rng) {
      var statements = [
        { t: "A higher minimum wage raises unemployment among young workers.", kind: "positive" },
        { t: "The government should raise the minimum wage.", kind: "normative" },
        { t: "Rent control leads to housing shortages.", kind: "positive" },
        { t: "Society ought to reduce income inequality.", kind: "normative" },
        { t: "Cutting the tax rate would increase consumer spending.", kind: "positive" },
        { t: "The rich should pay a larger share of taxes.", kind: "normative" }
      ];
      var s = rng_pick(rng, statements);
      var opts = ["A positive statement (a claim about what IS)",
        "A normative statement (a claim about what OUGHT to be)"];
      var correct = s.kind === "positive" ? 0 : 1;
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "Classify this statement: \u201c" + s.t + "\u201d",
        options: sh.options, answer: sh.correctIndex,
        rationale: "Positive = descriptive/testable (what is); normative = value judgment (what ought to be). This one is " + s.kind + "."
      };
    }
  };

  /* ===================== CHAPTER 3 — Gains from Trade =================== */

  /* ---- comparative advantage (Ch3, numeric) ----------------------------
     Two producers, two goods, output-per-hour (or per-day) table. Compute
     opportunity costs and determine who has comparative advantage in a good. */
  GEN["comparative_advantage"] = {
    id: "comparative_advantage", chapter: 3, kind: "mc", render: "text",
    difficulty: "hard", concept: "comparative advantage", points: 2,
    build: function (rng) {
      var pplA = rng_pick(rng, ["Alia", "Farmer", "Country A", "Nadia"]);
      var pplB = rng_pick(rng, ["Ben", "Rancher", "Country B", "Omar"]);
      while (pplB === pplA) { pplB = rng_pick(rng, ["Ben", "Rancher", "Country B", "Omar"]); }
      var goods = rng_pick(rng, [["wheat", "cloth"], ["corn", "beef"], ["cars", "grain"], ["fish", "rice"]]);
      var g1 = goods[0], g2 = goods[1];
      /* outputs per day; ensure comparative advantage is well-defined & not identical */
      var a1 = rng_int(rng, 4, 10), a2 = rng_int(rng, 4, 10);
      var b1 = rng_int(rng, 4, 10), b2 = rng_int(rng, 4, 10);
      /* opp cost of one unit g1 (in g2) = (g2 output)/(g1 output) */
      var ocA = a2 / a1;   /* A's opp cost of g1 */
      var ocB = b2 / b1;   /* B's opp cost of g1 */
      /* regenerate if tie */
      var guard = 0;
      while (Math.abs(ocA - ocB) < 1e-9 && guard < 20) {
        a1 = rng_int(rng, 4, 10); a2 = rng_int(rng, 4, 10);
        ocA = a2 / a1; ocB = b2 / b1; guard++;
      }
      /* whoever has LOWER opp cost of g1 has comparative advantage in g1 */
      var caG1 = ocA < ocB ? pplA : pplB;
      var opts = [pplA + " has comparative advantage in " + g1,
        pplB + " has comparative advantage in " + g1,
        "Neither has a comparative advantage",
        "Both have comparative advantage in " + g1];
      var correct = (caG1 === pplA) ? 0 : 1;
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "In one day, " + pplA + " can produce " + a1 + " " + g1 + " or " + a2 + " " + g2 + ". " +
          pplB + " can produce " + b1 + " " + g1 + " or " + b2 + " " + g2 +
          ". Who has the comparative advantage in producing " + g1 + "?",
        options: sh.options, answer: sh.correctIndex,
        rationale: pplA + "'s opportunity cost of 1 " + g1 + " = " + round2(ocA) + " " + g2 + "; " +
          pplB + "'s = " + round2(ocB) + " " + g2 + ". Lower opp cost \u2192 comparative advantage, so " + caG1 + "."
      };
    }
  };

  /* ---- opportunity cost from a production table (Ch3, numeric) ---------- */
  GEN["opp_cost_table"] = {
    id: "opp_cost_table", chapter: 3, kind: "numeric", render: "text",
    difficulty: "med", concept: "opportunity cost of trade", points: 2,
    build: function (rng) {
      var who = rng_pick(rng, ["A worker", "A factory", "Maria", "A farm"]);
      var g1 = rng_pick(rng, ["shirts", "tables", "phones", "loaves"]);
      var g2 = rng_pick(rng, ["shoes", "chairs", "cases", "cakes"]);
      var out1 = rng_int(rng, 6, 12), out2 = rng_int(rng, 3, 10);
      var oc = round2(out2 / out1);
      return {
        prompt: who + " can make " + out1 + " " + g1 + " or " + out2 + " " + g2 +
          " in a day. What is the opportunity cost of making ONE " + g1 + " (in " + g2 + ")?",
        answer: oc, tolerance: 0.05,
        rationale: "Opp cost of 1 " + g1 + " = " + g2 + " forgone / " + g1 + " made = " +
          out2 + "/" + out1 + " = " + oc + " " + g2 + "."
      };
    }
  };

  /* ===================== CHAPTER 5 — Elasticity ======================== */

  /* ---- price elasticity of demand, midpoint method (numeric) ------------ */
  GEN["elasticity_midpoint"] = {
    id: "elasticity_midpoint", chapter: 5, kind: "numeric", render: "text",
    difficulty: "hard", concept: "price elasticity (midpoint)", points: 2,
    build: function (rng) {
      /* choose two price/quantity points with clean midpoint arithmetic */
      var p1 = rng_int(rng, 4, 8), p2 = p1 + rng_int(rng, 2, 4);
      var q1 = rng_int(rng, 40, 60), q2 = q1 - rng_int(rng, 8, 20);
      /* midpoint elasticity = (%dQ)/(%dP), using averages; report magnitude */
      var pctQ = (q2 - q1) / ((q1 + q2) / 2);
      var pctP = (p2 - p1) / ((p1 + p2) / 2);
      var e = Math.abs(pctQ / pctP);
      return {
        prompt: "When the price rises from $" + p1 + " to $" + p2 + ", quantity demanded falls from " +
          q1 + " to " + q2 + " units. Using the midpoint method, what is the price elasticity of demand? (Report the absolute value, rounded to 2 decimals.)",
        answer: round2(e), tolerance: 0.03,
        rationale: "Midpoint: %\u0394Q = (" + q2 + "\u2212" + q1 + ")/avg = " + round2(pctQ * 100) + "%, %\u0394P = " +
          round2(pctP * 100) + "%. Elasticity = |" + round2(pctQ * 100) + "/" + round2(pctP * 100) + "| = " + round2(e) + "."
      };
    }
  };

  /* ---- elastic vs inelastic classification (MC) ------------------------- */
  GEN["elasticity_classify"] = {
    id: "elasticity_classify", chapter: 5, kind: "mc", render: "text",
    difficulty: "med", concept: "elastic vs inelastic", points: 1,
    build: function (rng) {
      var e = round2(rng_pick(rng, [0.2, 0.4, 0.6, 0.8, 1.2, 1.5, 2.0, 2.5]));
      var opts = ["Elastic (demand responds a lot to price)",
        "Inelastic (demand responds little to price)",
        "Unit elastic", "Perfectly inelastic"];
      var correct = e > 1 ? 0 : (e < 1 ? 1 : 2);
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "The price elasticity of demand for a good is " + e + ". Demand for this good is:",
        options: sh.options, answer: sh.correctIndex,
        rationale: "|E| > 1 is elastic, |E| < 1 inelastic, = 1 unit elastic. Here E = " + e + "."
      };
    }
  };

  /* ---- total revenue test (MC) ------------------------------------------ */
  GEN["elasticity_revenue"] = {
    id: "elasticity_revenue", chapter: 5, kind: "mc", render: "text",
    difficulty: "hard", concept: "total revenue test", points: 2,
    build: function (rng) {
      var elastic = rng() < 0.5;
      var raise = rng() < 0.5;
      /* elastic + price up -> revenue down; inelastic + price up -> revenue up; etc. */
      var revUp = raise ? !elastic : elastic;
      var opts = ["Total revenue rises", "Total revenue falls",
        "Total revenue is unchanged", "Total revenue could go either way"];
      var correct = revUp ? 0 : 1;
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "Demand for a good is " + (elastic ? "elastic" : "inelastic") + ". If the seller " +
          (raise ? "raises" : "lowers") + " the price, what happens to total revenue?",
        options: sh.options, answer: sh.correctIndex,
        rationale: "When demand is " + (elastic ? "elastic, price and revenue move in OPPOSITE directions" :
          "inelastic, price and revenue move in the SAME direction") + "."
      };
    }
  };

  /* ---- income elasticity sign -> normal/inferior (MC) ------------------- */
  GEN["income_elasticity"] = {
    id: "income_elasticity", chapter: 5, kind: "mc", render: "text",
    difficulty: "med", concept: "income elasticity", points: 1,
    build: function (rng) {
      var val = round2(rng_pick(rng, [-1.5, -0.8, -0.4, 0.5, 0.9, 1.4, 2.0]));
      var opts = ["A normal good", "An inferior good", "A luxury (income-elastic normal good)", "A Giffen good"];
      var correct;
      if (val < 0) { correct = 1; }
      else if (val > 1) { correct = 2; }
      else { correct = 0; }
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "A good has an income elasticity of demand equal to " + val + ". This good is best classified as:",
        options: sh.options, answer: sh.correctIndex,
        rationale: "Income elasticity < 0 \u2192 inferior; 0 to 1 \u2192 normal necessity; > 1 \u2192 normal luxury. Here it is " + val + "."
      };
    }
  };

  /* ===================== CHAPTER 6 — Government Policies ================ */

  /* ---- price ceiling: shortage size (graphical numeric) ----------------- */
  GEN["ceiling_shortage"] = {
    id: "ceiling_shortage", chapter: 6, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "binding price ceiling", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]); var d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 5, 8); var c = rng_int(rng, 1, 3);
      var pStar = c + d * qStar; var a = pStar + b * qStar;
      /* binding ceiling BELOW pStar */
      var ceil = pStar - rng_int(rng, 1, Math.max(1, Math.floor(pStar - c - 1)));
      var qd = (a - ceil) / b;       /* quantity demanded at ceiling */
      var qs = (ceil - c) / d;       /* quantity supplied at ceiling */
      var shortage = round2(qd - qs);
      return {
        prompt: "Demand is P = " + a + " \u2212 " + fmtCoef(b) + "Q and supply is P = " + c + " + " + fmtCoef(d) +
          "Q. The government sets a price ceiling of $" + ceil + ". What is the resulting shortage (Qd \u2212 Qs)?",
        diagramSpec: { type: "price_control", dA: a, dB: -b, sA: c, sB: d, control: "ceiling", level: ceil,
          qmax: Math.max(10, qStar + 4), pmax: Math.max(12, a + 1) },
        answer: shortage, tolerance: 0.1,
        rationale: "At P=" + ceil + ": Qd = (" + a + "\u2212" + ceil + ")/" + b + " = " + round2(qd) +
          ", Qs = (" + ceil + "\u2212" + c + ")/" + d + " = " + round2(qs) + ". Shortage = " + shortage + "."
      };
    }
  };

  /* ---- price floor: surplus size (graphical numeric) -------------------- */
  GEN["floor_surplus"] = {
    id: "floor_surplus", chapter: 6, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "binding price floor", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]); var d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 5, 8); var c = rng_int(rng, 1, 3);
      var pStar = c + d * qStar; var a = pStar + b * qStar;
      var floor = pStar + rng_int(rng, 1, 3);   /* binding floor ABOVE pStar */
      var qd = (a - floor) / b;
      var qs = (floor - c) / d;
      var surplus = round2(qs - qd);
      return {
        prompt: "Demand is P = " + a + " \u2212 " + fmtCoef(b) + "Q and supply is P = " + c + " + " + fmtCoef(d) +
          "Q. The government sets a price floor of $" + floor + ". What is the resulting surplus (Qs \u2212 Qd)?",
        diagramSpec: { type: "price_control", dA: a, dB: -b, sA: c, sB: d, control: "floor", level: floor,
          qmax: Math.max(10, qStar + 4), pmax: Math.max(12, a + 1) },
        answer: surplus, tolerance: 0.1,
        rationale: "At P=" + floor + ": Qs = (" + floor + "\u2212" + c + ")/" + d + " = " + round2(qs) +
          ", Qd = (" + a + "\u2212" + floor + ")/" + b + " = " + round2(qd) + ". Surplus = " + surplus + "."
      };
    }
  };

  /* ---- tax: new quantity after a per-unit tax (graphical numeric) ------- */
  GEN["tax_quantity"] = {
    id: "tax_quantity", chapter: 6, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "effect of a tax", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]); var d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 5, 8); var c = rng_int(rng, 1, 3);
      var pStar = c + d * qStar; var a = pStar + b * qStar;
      var tax = rng_int(rng, 2, 5);
      var qt = (a - c - tax) / (b + d);   /* new quantity with tax */
      return {
        prompt: "Demand is P = " + a + " \u2212 " + fmtCoef(b) + "Q and supply is P = " + c + " + " + fmtCoef(d) +
          "Q. A per-unit tax of $" + tax + " is imposed. What is the new quantity traded?",
        diagramSpec: { type: "tax", dA: a, dB: -b, sA: c, sB: d, tax: tax,
          qmax: Math.max(10, qStar + 4), pmax: Math.max(12, a + tax + 1) },
        answer: round2(qt), tolerance: 0.1,
        rationale: "With the tax, set " + a + "\u2212" + fmtCoef(b) + "Q = " + (c) + "+" + tax + "+" + fmtCoef(d) +
          "Q \u2192 Q = " + round2(qt) + "."
      };
    }
  };

  /* ---- tax incidence direction (MC conceptual) -------------------------- */
  GEN["tax_incidence"] = {
    id: "tax_incidence", chapter: 6, kind: "mc", render: "text",
    difficulty: "hard", concept: "tax incidence", points: 2,
    build: function (rng) {
      /* the more inelastic side bears more of the tax */
      var demandInelastic = rng() < 0.5;
      var opts = ["Buyers bear more of the tax", "Sellers bear more of the tax",
        "Buyers and sellers bear it equally", "Neither bears any of the tax"];
      var correct = demandInelastic ? 0 : 1;
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "A per-unit tax is placed on a good. Demand is " + (demandInelastic ? "relatively inelastic" : "relatively elastic") +
          " and supply is " + (demandInelastic ? "relatively elastic" : "relatively inelastic") +
          ". Who bears the larger share of the tax burden?",
        options: sh.options, answer: sh.correctIndex,
        rationale: "The more INELASTIC side of the market bears more of the tax. Here that is " +
          (demandInelastic ? "buyers (demand)" : "sellers (supply)") + "."
      };
    }
  };

  /* ===================== CHAPTER 7 — Welfare / Efficiency ============== */
  /* (sd_consumer_surplus, sd_producer_surplus, sd_total_surplus already exist) */

  /* ---- change in total surplus from a shift (numeric) ------------------- */
  GEN["welfare_efficiency"] = {
    id: "welfare_efficiency", chapter: 7, kind: "mc", render: "text",
    difficulty: "med", concept: "market efficiency", points: 1,
    build: function (rng) {
      var opts = ["at the competitive equilibrium quantity",
        "at a quantity below the equilibrium",
        "at a quantity above the equilibrium",
        "where consumer surplus is zero"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "In a competitive market with no externalities, total surplus (consumer + producer surplus) is maximized:",
        options: sh.options, answer: sh.correctIndex,
        rationale: "Total surplus is maximized at the competitive equilibrium \u2014 the efficient quantity where marginal value equals marginal cost."
      };
    }
  };

  /* ---- consumer surplus from willingness-to-pay (numeric) --------------- */
  GEN["cs_from_wtp"] = {
    id: "cs_from_wtp", chapter: 7, kind: "numeric", render: "text",
    difficulty: "med", concept: "consumer surplus", points: 2,
    build: function (rng) {
      var price = rng_int(rng, 8, 15);
      /* a few buyers with willingness-to-pay at or above/below price */
      var wtps = [];
      var n = rng_int(rng, 4, 5);
      for (var i = 0; i < n; i++) { wtps.push(price + rng_int(rng, -4, 8)); }
      /* CS = sum over buyers who buy (wtp >= price) of (wtp - price) */
      var cs = 0;
      wtps.forEach(function (w) { if (w >= price) { cs += (w - price); } });
      return {
        prompt: "The market price is $" + price + ". Five consumers have willingness-to-pay values of $" +
          wtps.join(", $") + ". What is the total consumer surplus? (Only those who buy \u2014 WTP at least the price \u2014 contribute.)",
        answer: cs, tolerance: 0.01,
        rationale: "Each buyer with WTP \u2265 $" + price + " contributes (WTP \u2212 price). Summing those gives $" + cs + "."
      };
    }
  };

  /* ---- producer surplus from seller costs (numeric) --------------------- */
  GEN["ps_from_cost"] = {
    id: "ps_from_cost", chapter: 7, kind: "numeric", render: "text",
    difficulty: "med", concept: "producer surplus", points: 2,
    build: function (rng) {
      var price = rng_int(rng, 8, 15);
      var costs = [];
      var n = rng_int(rng, 4, 5);
      for (var i = 0; i < n; i++) { costs.push(price + rng_int(rng, -8, 4)); }
      /* PS = sum over sellers who sell (cost <= price) of (price - cost) */
      var ps = 0;
      costs.forEach(function (c) { if (c <= price) { ps += (price - c); } });
      return {
        prompt: "The market price is $" + price + ". Five sellers have costs of $" + costs.join(", $") +
          ". What is the total producer surplus? (Only sellers whose cost is at most the price sell.)",
        answer: ps, tolerance: 0.01,
        rationale: "Each seller with cost \u2264 $" + price + " contributes (price \u2212 cost). Summing gives $" + ps + "."
      };
    }
  };

  /* ---- deadweight loss reasoning below efficient quantity (MC) ---------- */
  GEN["dwl_underproduction"] = {
    id: "dwl_underproduction", chapter: 7, kind: "mc", render: "text",
    difficulty: "hard", concept: "efficiency and lost surplus", points: 2,
    build: function (rng) {
      var below = rng() < 0.5;
      var opts = [
        "Some units whose value to buyers exceeds their cost go unproduced \u2014 surplus is lost",
        "Some units are produced whose cost exceeds their value to buyers \u2014 surplus is lost",
        "Total surplus is unaffected", "Consumer surplus rises but producer surplus falls by the same amount"];
      var correct = below ? 0 : 1;
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "Suppose a market produces a quantity " + (below ? "BELOW" : "ABOVE") +
          " the competitive equilibrium. Why is total surplus lower than at equilibrium?",
        options: sh.options, answer: sh.correctIndex,
        rationale: below ?
          "Below equilibrium, mutually beneficial trades (value > cost) don't happen \u2014 that foregone surplus is the loss." :
          "Above equilibrium, units are made whose cost exceeds buyers' value \u2014 producing them destroys surplus."
      };
    }
  };

  /* ---- willingness to pay concept (MC) ---------------------------------- */
  GEN["wtp_concept"] = {
    id: "wtp_concept", chapter: 7, kind: "mc", render: "text",
    difficulty: "easy", concept: "willingness to pay", points: 1,
    build: function (rng) {
      var opts = ["the maximum a buyer will pay for a good",
        "the price the buyer actually pays",
        "the seller's cost of production",
        "the quantity the buyer demands"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "A buyer's \u201cwillingness to pay\u201d is:",
        options: sh.options, answer: sh.correctIndex,
        rationale: "Willingness to pay is the maximum price a buyer would accept \u2014 the height of the demand curve for that unit."
      };
    }
  };

  /* ===================== CHAPTER 8 — Costs of Taxation ================= */

  /* ---- deadweight loss of a tax (graphical numeric) --------------------- */
  GEN["tax_dwl"] = {
    id: "tax_dwl", chapter: 8, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "deadweight loss", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]); var d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 5, 8); var c = rng_int(rng, 1, 3);
      var pStar = c + d * qStar; var a = pStar + b * qStar;
      var tax = rng_int(rng, 2, 5);
      var qt = (a - c - tax) / (b + d);         /* quantity with tax */
      var dwl = 0.5 * tax * (qStar - qt);        /* DWL triangle area */
      return {
        prompt: "Demand is P = " + a + " \u2212 " + fmtCoef(b) + "Q and supply is P = " + c + " + " + fmtCoef(d) +
          "Q. A per-unit tax of $" + tax + " is imposed. What is the deadweight loss? (Round to 2 decimals.)",
        diagramSpec: { type: "tax", dA: a, dB: -b, sA: c, sB: d, tax: tax,
          qmax: Math.max(10, qStar + 4), pmax: Math.max(12, a + tax + 1) },
        answer: round2(dwl), tolerance: 0.2,
        rationale: "DWL = \u00bd \u00d7 tax \u00d7 (Q* \u2212 Q_tax) = \u00bd \u00d7 " + tax + " \u00d7 (" + qStar + " \u2212 " +
          round2(qt) + ") = " + round2(dwl) + "."
      };
    }
  };

  /* ---- tax revenue (graphical numeric) ---------------------------------- */
  GEN["tax_revenue"] = {
    id: "tax_revenue", chapter: 8, kind: "numeric", render: "graphical",
    difficulty: "med", concept: "tax revenue", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]); var d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 5, 8); var c = rng_int(rng, 1, 3);
      var pStar = c + d * qStar; var a = pStar + b * qStar;
      var tax = rng_int(rng, 2, 5);
      var qt = (a - c - tax) / (b + d);
      var rev = tax * qt;
      return {
        prompt: "Demand is P = " + a + " \u2212 " + fmtCoef(b) + "Q and supply is P = " + c + " + " + fmtCoef(d) +
          "Q. A per-unit tax of $" + tax + " is imposed. How much tax revenue does the government collect? (Round to 2 decimals.)",
        diagramSpec: { type: "tax", dA: a, dB: -b, sA: c, sB: d, tax: tax, showRevenue: true,
          qmax: Math.max(10, qStar + 4), pmax: Math.max(12, a + tax + 1) },
        answer: round2(rev), tolerance: 0.2,
        rationale: "Tax revenue = tax \u00d7 quantity traded = " + tax + " \u00d7 " + round2(qt) + " = " + round2(rev) + "."
      };
    }
  };

  /* ---- DWL grows with tax size (MC conceptual) -------------------------- */
  GEN["dwl_tax_size"] = {
    id: "dwl_tax_size", chapter: 8, kind: "mc", render: "text",
    difficulty: "hard", concept: "how DWL scales", points: 2,
    build: function (rng) {
      var factor = rng_pick(rng, [2, 3]);
      var opts = ["by a factor of " + (factor * factor) + " (proportional to the square of the tax)",
        "by a factor of " + factor + " (proportional to the tax)",
        "it stays the same", "by a factor of " + (factor + 1)];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "If a per-unit tax is " + factor + "\u00d7 larger (holding the demand and supply curves fixed), the deadweight loss roughly increases:",
        options: sh.options, answer: sh.correctIndex,
        rationale: "DWL \u2248 \u00bd \u00d7 tax \u00d7 \u0394Q, and \u0394Q itself grows with the tax, so DWL grows with the SQUARE of the tax. A " +
          factor + "\u00d7 tax \u2192 about " + (factor * factor) + "\u00d7 the DWL."
      };
    }
  };

  /* ===================== CHAPTER 9 — Costs of Production =============== */

  /* ---- marginal cost from a total-cost table (numeric) ------------------ */
  GEN["marginal_cost_calc"] = {
    id: "marginal_cost_calc", chapter: 9, kind: "numeric", render: "text",
    difficulty: "med", concept: "marginal cost", points: 1,
    build: function (rng) {
      var q1 = rng_int(rng, 3, 6);
      var tc1 = rng_int(rng, 40, 80);
      var mc = rng_int(rng, 6, 18);
      var tc2 = tc1 + mc;   /* producing one more unit adds mc */
      return {
        prompt: "A firm's total cost of producing " + q1 + " units is $" + tc1 + ", and its total cost of producing " +
          (q1 + 1) + " units is $" + tc2 + ". What is the marginal cost of the " + (q1 + 1) + "th unit?",
        answer: mc, tolerance: 0.01,
        rationale: "Marginal cost = \u0394TC / \u0394Q = ($" + tc2 + " \u2212 $" + tc1 + ") / 1 = $" + mc + "."
      };
    }
  };

  /* ---- average total cost (numeric) ------------------------------------- */
  GEN["average_total_cost"] = {
    id: "average_total_cost", chapter: 9, kind: "numeric", render: "text",
    difficulty: "easy", concept: "average total cost", points: 1,
    build: function (rng) {
      var q = rng_int(rng, 4, 10);
      var atc = rng_int(rng, 5, 15);
      var tc = q * atc;   /* clean division */
      return {
        prompt: "A firm produces " + q + " units at a total cost of $" + tc +
          ". What is its average total cost per unit?",
        answer: atc, tolerance: 0.01,
        rationale: "ATC = total cost / quantity = $" + tc + " / " + q + " = $" + atc + "."
      };
    }
  };

  /* ---- fixed vs variable cost (MC) -------------------------------------- */
  GEN["fixed_variable_cost"] = {
    id: "fixed_variable_cost", chapter: 9, kind: "mc", render: "text",
    difficulty: "easy", concept: "fixed vs variable costs", points: 1,
    build: function (rng) {
      var items = [
        { t: "monthly rent on the factory building", fixed: true },
        { t: "raw materials used in each unit", fixed: false },
        { t: "hourly wages of assembly-line workers", fixed: false },
        { t: "the annual insurance premium", fixed: true },
        { t: "electricity that runs the machines during production", fixed: false },
        { t: "a one-time patent license fee", fixed: true }
      ];
      var it = rng_pick(rng, items);
      var opts = ["A fixed cost", "A variable cost"];
      var correct = it.fixed ? 0 : 1;
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "For a manufacturing firm, which best describes " + it.t + "?",
        options: sh.options, answer: sh.correctIndex,
        rationale: (it.fixed ? "Fixed costs don't vary with output in the short run." :
          "Variable costs rise and fall with the quantity produced.") + " This is a " + (it.fixed ? "fixed" : "variable") + " cost."
      };
    }
  };

  /* ---- MC and ATC relationship (graphical MC) --------------------------- */
  GEN["mc_atc_relationship"] = {
    id: "mc_atc_relationship", chapter: 9, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "MC crosses ATC at minimum", points: 2,
    build: function (rng) {
      var fc = rng_pick(rng, [16, 18, 20, 24]);
      var a = rng_pick(rng, [2, 3]);
      var b = rng_pick(rng, [1, 1.1, 1.2]);
      var opts = ["at the minimum of ATC", "at the maximum of ATC",
        "to the left of ATC's minimum", "MC never crosses ATC"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "The diagram shows a firm's cost curves. The marginal-cost curve crosses the average-total-cost curve:",
        diagramSpec: { type: "cost_curves", qmax: 10, cmax: 20, fc: fc, a: a, b: b, showATC: true, showAVC: true },
        options: sh.options, answer: sh.correctIndex,
        rationale: "MC intersects ATC exactly at ATC's minimum: when MC < ATC it pulls the average down; when MC > ATC it pushes it up."
      };
    }
  };

  /* ===================== CHAPTER 10 — Competitive Firms =============== */

  /* ---- profit-maximizing quantity: P = MC (numeric) --------------------- */
  GEN["profit_max_pmc"] = {
    id: "profit_max_pmc", chapter: 10, kind: "numeric", render: "text",
    difficulty: "med", concept: "profit maximization P=MC", points: 2,
    build: function (rng) {
      /* MC = a + b*q ; competitive firm sets P = MC -> q = (P-a)/b */
      var a = rng_int(rng, 2, 5);
      var b = rng_pick(rng, [1, 2]);
      var q = rng_int(rng, 3, 8);
      var price = a + b * q;   /* choose price so q is integer */
      return {
        prompt: "A competitive firm has marginal cost MC = " + a + " + " + fmtCoef(b) + "Q. The market price is $" +
          price + ". What quantity maximizes the firm's profit?",
        answer: q, tolerance: 0.01,
        rationale: "A competitive firm produces where P = MC: " + price + " = " + a + " + " + fmtCoef(b) +
          "Q \u2192 Q = " + q + "."
      };
    }
  };

  /* ---- shutdown decision (MC) ------------------------------------------- */
  GEN["shutdown_decision"] = {
    id: "shutdown_decision", chapter: 10, kind: "mc", render: "text",
    difficulty: "hard", concept: "shutdown rule", points: 2,
    build: function (rng) {
      var price = rng_int(rng, 6, 14);
      var avc = rng_int(rng, 4, 16);
      while (avc === price) { avc = rng_int(rng, 4, 16); }
      var produce = price >= avc;   /* operate if P >= AVC in the short run */
      var opts = ["Keep producing in the short run", "Shut down in the short run"];
      var correct = produce ? 0 : 1;
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "In the short run, a competitive firm faces a price of $" + price +
          " and its average variable cost at the profit-maximizing quantity is $" + avc +
          ". What should the firm do?",
        options: sh.options, answer: sh.correctIndex,
        rationale: "Short-run shutdown rule: operate if P \u2265 AVC, shut down if P < AVC. Here P = $" + price +
          " and AVC = $" + avc + ", so " + (produce ? "keep producing." : "shut down.")
      };
    }
  };

  /* ---- profit or loss at P=MC (numeric) --------------------------------- */
  GEN["firm_profit_calc"] = {
    id: "firm_profit_calc", chapter: 10, kind: "numeric", render: "text",
    difficulty: "hard", concept: "firm profit", points: 2,
    build: function (rng) {
      var q = rng_int(rng, 4, 9);
      var price = rng_int(rng, 8, 16);
      var atc = rng_int(rng, 5, 15);
      var profit = (price - atc) * q;   /* can be negative (loss) */
      return {
        prompt: "A competitive firm produces " + q + " units, sells each at the market price of $" + price +
          ", and has an average total cost of $" + atc + " per unit. What is its total profit? (A loss is negative.)",
        answer: profit, tolerance: 0.01,
        rationale: "Profit = (P \u2212 ATC) \u00d7 Q = ($" + price + " \u2212 $" + atc + ") \u00d7 " + q + " = $" + profit + "."
      };
    }
  };

  /* ---- S1..S3: STATIC conceptual / written (no randomization) -----------
     These carry their own fixed content; the engine returns them as-is. */
  var STATIC = [
    {
      id: "ch4_law_demand_mc", chapter: 4, kind: "mc", render: "text",
      difficulty: "easy", concept: "law of demand", points: 1,
      prompt: "The law of demand states that, other things equal, when the price of a good rises:",
      options: [
        "the quantity demanded of the good falls",
        "the demand for the good increases",
        "the supply of the good falls",
        "consumers' income decreases"
      ],
      answer: 0,
      rationale: "Law of demand: price up \u2192 quantity demanded down, a movement along the curve (not a shift)."
    },
    {
      id: "ch4_change_qd_vs_d", chapter: 4, kind: "mc", render: "text",
      difficulty: "med", concept: "movement vs shift", points: 1,
      prompt: "A news report says orange juice sales fell after a frost destroyed much of the orange crop. In supply-and-demand terms, the frost primarily caused:",
      options: [
        "a leftward shift of the supply curve",
        "a movement down along the demand curve only",
        "a rightward shift of the demand curve",
        "a leftward shift of the demand curve"
      ],
      answer: 0,
      rationale: "A crop-destroying frost reduces supply (leftward shift); the higher price then reduces quantity demanded along demand."
    },
    {
      id: "ch4_written_shortage", chapter: 4, kind: "short", render: "text",
      difficulty: "med", concept: "disequilibrium", points: 3,
      prompt: "Explain, in 3\u20134 sentences, why a price set below the equilibrium price creates a shortage, and describe the market forces that push the price back toward equilibrium.",
      answer: null,   /* graded by AI/instructor via rubric */
      rubric: "Full credit: (1) at a below-equilibrium price, quantity demanded exceeds quantity supplied; (2) this gap is the shortage; (3) unsatisfied buyers bid the price up / sellers raise prices; (4) as price rises, Qd falls and Qs rises until they're equal at equilibrium. Award partial credit for each element present.",
      rationale: "Looking for the Qd>Qs mechanism plus the upward price adjustment restoring equilibrium."
    },
    {
      id: "ch4_ceteris_paribus", chapter: 4, kind: "mc", render: "text",
      difficulty: "easy", concept: "ceteris paribus", points: 1,
      prompt: "When economists draw a demand curve, they hold all factors other than the good's own price constant. This assumption is called:",
      options: ["ceteris paribus", "comparative advantage", "the invisible hand", "diminishing returns"],
      answer: 0,
      rationale: "'Ceteris paribus' means 'other things equal' \u2014 it lets us isolate the price\u2013quantity relationship."
    },
    {
      id: "ch4_normal_inferior", chapter: 4, kind: "mc", render: "text",
      difficulty: "med", concept: "normal vs inferior goods", points: 1,
      prompt: "A rise in income causes the demand for bus travel to fall. Bus travel is best described as:",
      options: ["an inferior good", "a normal good", "a complement to income", "a Giffen good"],
      answer: 0,
      rationale: "If a rise in income reduces demand, the good is inferior by definition."
    },
    {
      id: "ch4_written_shift_vs_move", chapter: 4, kind: "short", render: "text",
      difficulty: "hard", concept: "movement vs shift", points: 3,
      prompt: "A student claims: \u201cWhen the price of coffee rises, demand for coffee falls.\u201d Explain what is wrong with this statement using the correct economic terminology, and state what actually happens.",
      answer: null,
      rubric: "Full credit: (1) identifies the error \u2014 a price change does NOT shift demand; (2) correct term: it causes a decrease in QUANTITY DEMANDED, a movement ALONG the demand curve; (3) 'demand' (the whole curve) shifts only due to non-price determinants (income, tastes, related-goods prices, expectations, number of buyers). Partial credit per element.",
      rationale: "Key distinction: movement along vs shift of the demand curve."
    },
    /* ---- Chapter 1 ---- */
    {
      id: "ch1_opportunity_cost_def", chapter: 1, kind: "mc", render: "text",
      difficulty: "easy", concept: "opportunity cost", points: 1,
      prompt: "The opportunity cost of an item is best described as:",
      options: ["whatever you give up to get it", "the dollar price printed on it",
        "the time it takes to obtain it", "the marginal benefit it provides"],
      answer: 0,
      rationale: "Opportunity cost is what you must give up (the next-best alternative) to obtain something \u2014 not just its money price."
    },
    {
      id: "ch1_incentives", chapter: 1, kind: "mc", render: "text",
      difficulty: "med", concept: "people respond to incentives", points: 1,
      prompt: "A city introduces a $0.10 tax on each plastic bag. Shoppers begin bringing reusable bags. This best illustrates the principle that:",
      options: ["people respond to incentives", "trade can make everyone better off",
        "markets are usually a good way to organize activity", "the cost of something is what you give up"],
      answer: 0,
      rationale: "A change in the cost/benefit at the margin (the small tax) changed behavior \u2014 people respond to incentives."
    },
    {
      id: "ch1_written_tradeoff", chapter: 1, kind: "short", render: "text",
      difficulty: "med", concept: "tradeoffs", points: 3,
      prompt: "Explain what economists mean by \u201cthere is no such thing as a free lunch,\u201d and give one concrete example of a tradeoff a college student faces.",
      answer: null,
      rubric: "Full credit: (1) getting one thing usually requires giving up another (scarcity forces tradeoffs); (2) resources (time, money) are limited; (3) a concrete, valid student example (e.g., time studying vs. working vs. socializing). Partial credit per element.",
      rationale: "Looking for the scarcity/tradeoff idea plus a valid concrete example."
    },
    /* ---- Chapter 2 ---- */
    {
      id: "ch2_ppf_concept", chapter: 2, kind: "mc", render: "text",
      difficulty: "med", concept: "production possibilities frontier", points: 1,
      prompt: "A point INSIDE (below) a production possibilities frontier represents production that is:",
      options: ["inefficient \u2014 more of both goods could be produced", "efficient and on the frontier",
        "unattainable with current resources", "impossible under any circumstances"],
      answer: 0,
      rationale: "Inside the PPF means resources are idle or misallocated \u2014 more of both goods is possible, so it's inefficient."
    },
    {
      id: "ch2_micro_macro", chapter: 2, kind: "mc", render: "text",
      difficulty: "easy", concept: "micro vs macro", points: 1,
      prompt: "Which question is a MICROeconomic question rather than a macroeconomic one?",
      options: ["How does a tax on sugary drinks affect soda consumption?",
        "What causes national unemployment to rise?",
        "Why does the overall price level increase over time?",
        "What determines a country's rate of economic growth?"],
      answer: 0,
      rationale: "Microeconomics studies individual markets/agents (the soda market); the others are economy-wide (macro)."
    },
    /* ---- Chapter 3 ---- */
    {
      id: "ch3_absolute_vs_comparative", chapter: 3, kind: "mc", render: "text",
      difficulty: "med", concept: "absolute vs comparative advantage", points: 1,
      prompt: "The gains from trade between two people are based on:",
      options: ["comparative advantage (lower opportunity cost)", "absolute advantage (higher total output)",
        "who works more hours", "who has more resources"],
      answer: 0,
      rationale: "Specialization and trade are driven by comparative advantage \u2014 lower opportunity cost \u2014 not absolute advantage."
    },
    {
      id: "ch3_written_gains_trade", chapter: 3, kind: "short", render: "text",
      difficulty: "hard", concept: "gains from trade", points: 3,
      prompt: "Even if one country can produce EVERYTHING more efficiently than another (has absolute advantage in all goods), trade can still benefit both. Explain why, using the idea of comparative advantage.",
      answer: null,
      rubric: "Full credit: (1) absolute advantage in all goods does not eliminate gains from trade; (2) comparative advantage = lower opportunity cost; (3) each country specializes where its opportunity cost is lowest; (4) specialization + trade expands total output so both can consume beyond their own PPF. Partial credit per element.",
      rationale: "Key idea: comparative advantage, not absolute, drives mutually beneficial trade."
    },
    /* ---- Chapter 5 ---- */
    {
      id: "ch5_elastic_determinants", chapter: 5, kind: "mc", render: "text",
      difficulty: "med", concept: "determinants of elasticity", points: 1,
      prompt: "Which good is likely to have the MOST price-elastic demand?",
      options: ["A specific brand of soda with many substitutes", "Insulin for a diabetic",
        "Salt", "Gasoline in the short run"],
      answer: 0,
      rationale: "Demand is more elastic when close substitutes exist and the good is a small, postponable, narrowly-defined purchase. A specific soda brand has many substitutes."
    },
    {
      id: "ch5_written_revenue", chapter: 5, kind: "short", render: "text",
      difficulty: "hard", concept: "elasticity and revenue", points: 3,
      prompt: "A concert promoter says: \u201cWe should raise ticket prices to increase our revenue.\u201d Under what elasticity condition is this true, and under what condition would it backfire? Explain using the total-revenue test.",
      answer: null,
      rubric: "Full credit: (1) if demand is INELASTIC (|E|<1), raising price increases revenue; (2) if demand is ELASTIC (|E|>1), raising price DECREASES revenue (quantity falls proportionally more); (3) correctly connects to the total-revenue test (P and TR move together when inelastic, opposite when elastic). Partial credit per element.",
      rationale: "Total-revenue test: inelastic \u2192 raise price to raise revenue; elastic \u2192 raising price backfires."
    },
    /* ---- Chapter 6 ---- */
    {
      id: "ch6_ceiling_concept", chapter: 6, kind: "mc", render: "text",
      difficulty: "med", concept: "price ceilings", points: 1,
      prompt: "For a price ceiling to cause a shortage, it must be set:",
      options: ["below the equilibrium price", "above the equilibrium price",
        "exactly at the equilibrium price", "at any price \u2014 ceilings always cause shortages"],
      answer: 0,
      rationale: "A price ceiling only binds (and causes a shortage) when it is BELOW equilibrium. Above equilibrium it has no effect."
    },
    {
      id: "ch6_tax_wedge", chapter: 6, kind: "mc", render: "text",
      difficulty: "med", concept: "effect of a tax", points: 1,
      prompt: "When a per-unit tax is imposed on a good, the price buyers pay and the price sellers receive:",
      options: ["differ by the amount of the tax", "are equal, as before the tax",
        "both rise by the full amount of the tax", "both fall by the full amount of the tax"],
      answer: 0,
      rationale: "A tax drives a wedge between the buyer's price and the seller's price equal to the per-unit tax."
    },
    /* ---- Chapter 7 ---- */
    {
      id: "ch7_consumer_surplus_def", chapter: 7, kind: "mc", render: "text",
      difficulty: "easy", concept: "consumer surplus", points: 1,
      prompt: "Consumer surplus is best defined as:",
      options: ["the amount a buyer is willing to pay minus the amount actually paid",
        "the total amount buyers spend on a good",
        "the profit a seller earns on a sale",
        "the area below the supply curve"],
      answer: 0,
      rationale: "Consumer surplus = willingness to pay \u2212 price paid, measured as the area below demand and above price."
    },
    {
      id: "ch7_written_efficiency", chapter: 7, kind: "short", render: "text",
      difficulty: "hard", concept: "market efficiency", points: 3,
      prompt: "Explain why the competitive market equilibrium maximizes total surplus. In your answer, describe what would be lost if output were pushed above or below the equilibrium quantity.",
      answer: null,
      rubric: "Full credit: (1) at equilibrium, marginal buyer's value = marginal seller's cost; (2) below equilibrium, some mutually beneficial trades don't happen (value > cost) \u2014 lost surplus; (3) above equilibrium, units are produced whose cost exceeds buyers' value \u2014 negative net value; (4) equilibrium therefore maximizes total (consumer + producer) surplus. Partial credit per element.",
      rationale: "Efficiency: equilibrium exhausts all gains from trade; deviating either way destroys surplus."
    },
    {
      id: "ch7_written_surplus_meaning", chapter: 7, kind: "short", render: "text",
      difficulty: "med", concept: "consumer and producer surplus", points: 3,
      prompt: "Define consumer surplus and producer surplus, and explain how each is shown on a supply-and-demand diagram. Why do economists treat their sum as a measure of the market's benefit to society?",
      answer: null,
      rubric: "Full credit: (1) consumer surplus = willingness to pay \u2212 price paid (area below demand, above price); (2) producer surplus = price received \u2212 cost (area above supply, below price); (3) total surplus = CS + PS measures the total net gain to buyers and sellers; (4) it captures the overall value the market creates, which is why it's used to judge efficiency. Partial credit per element.",
      rationale: "Looking for correct definitions, the diagram areas, and why total surplus measures social benefit."
    },
    /* ---- Chapter 8 ---- */
    {
      id: "ch8_dwl_concept", chapter: 8, kind: "mc", render: "text",
      difficulty: "med", concept: "deadweight loss", points: 1,
      prompt: "The deadweight loss of a tax represents:",
      options: ["the value of mutually beneficial trades that no longer happen because of the tax",
        "the total revenue the government collects",
        "the amount buyers pay in tax", "the profit sellers lose to competitors"],
      answer: 0,
      rationale: "Deadweight loss is the lost total surplus from trades that don't occur once the tax drives a wedge between buyers and sellers."
    },
    {
      id: "ch8_written_tax_tradeoff", chapter: 8, kind: "short", render: "text",
      difficulty: "hard", concept: "taxes and efficiency", points: 3,
      prompt: "A senator proposes doubling a per-unit tax to raise more revenue. Explain, using deadweight loss, why revenue may not double and why the efficiency cost rises faster than the tax rate.",
      answer: null,
      rubric: "Full credit: (1) a higher tax reduces the quantity traded, so revenue = tax \u00d7 (smaller Q) may less than double; (2) at high enough taxes revenue can even fall (Laffer idea); (3) DWL grows with the SQUARE of the tax because both the wedge and the quantity reduction grow; (4) so efficiency cost rises faster than the rate. Partial credit per element.",
      rationale: "Looking for the revenue = tax \u00d7 Q tradeoff and DWL scaling with the square of the tax."
    },
    /* ---- Chapter 9 ---- */
    {
      id: "ch9_economies_scale", chapter: 9, kind: "mc", render: "text",
      difficulty: "med", concept: "economies of scale", points: 1,
      prompt: "When a firm's average total cost falls as output rises, the firm is experiencing:",
      options: ["economies of scale", "diseconomies of scale",
        "constant returns to scale", "diminishing marginal utility"],
      answer: 0,
      rationale: "Falling ATC as output increases is the definition of economies of scale (often over the downward-sloping part of the ATC curve)."
    },
    {
      id: "ch9_written_mc_atc", chapter: 9, kind: "short", render: "text",
      difficulty: "hard", concept: "MC and ATC", points: 3,
      prompt: "Explain why the marginal-cost curve always crosses the average-total-cost curve at the ATC's minimum point. Use the analogy of how a new value affects an average.",
      answer: null,
      rubric: "Full credit: (1) when MC is below ATC, producing another unit pulls the average DOWN; (2) when MC is above ATC, it pulls the average UP; (3) therefore ATC is falling when MC<ATC and rising when MC>ATC; (4) so they must intersect exactly at ATC's minimum. A correct averaging analogy (e.g., a test score below your average lowers it) earns the analogy element. Partial credit per element.",
      rationale: "Looking for the below-pulls-down / above-pulls-up logic and the resulting minimum."
    },
    /* ---- Chapter 10 ---- */
    {
      id: "ch10_pmc_rule", chapter: 10, kind: "mc", render: "text",
      difficulty: "easy", concept: "profit maximization", points: 1,
      prompt: "A competitive (price-taking) firm maximizes profit by producing the quantity where:",
      options: ["price equals marginal cost", "price equals average total cost",
        "marginal cost is at its minimum", "total revenue is at its maximum"],
      answer: 0,
      rationale: "A competitive firm takes price as given and produces where P = MC (on the upward-sloping part of MC)."
    },
    {
      id: "ch10_written_shutdown", chapter: 10, kind: "short", render: "text",
      difficulty: "hard", concept: "shutdown vs exit", points: 3,
      prompt: "Distinguish between a firm's SHORT-RUN decision to shut down and its LONG-RUN decision to exit the market. What cost does each compare price to, and why are they different?",
      answer: null,
      rubric: "Full credit: (1) short-run shutdown: produce if P \u2265 AVC (fixed costs are sunk in the short run, so only variable costs matter); (2) long-run exit: leave if P < ATC (all costs are avoidable in the long run); (3) the difference is that fixed costs are unavoidable short-run but avoidable long-run; (4) hence the comparison uses AVC short-run and ATC long-run. Partial credit per element.",
      rationale: "Key distinction: AVC for short-run shutdown vs ATC for long-run exit, because of sunk fixed costs."
    }
  ];

  /* ---- public API ------------------------------------------------------- */

  /* generate a question instance from a generator id + seed.
     For STATIC items pass genId = the static item's id (seed ignored). */
  function generate(genId, seed, cfg) {
    var g = GEN[genId];
    if (g) {
      var rng = mulberry32((seed >>> 0) || 1);
      var built = g.build(rng, cfg || {});
      built.id = genId;
      built.kind = g.kind;
      built.render = g.render;
      built.chapter = g.chapter;
      built.difficulty = g.difficulty;
      built.concept = g.concept;
      built.points = g.points;
      built.seed = (seed >>> 0);
      return built;
    }
    /* fall back to static library */
    for (var i = 0; i < STATIC.length; i++) {
      if (STATIC[i].id === genId) {
        var s = {};
        for (var k in STATIC[i]) { if (STATIC[i].hasOwnProperty(k)) { s[k] = STATIC[i][k]; } }
        s.seed = null;
        return s;
      }
    }
    return null;
  }

  /* grade a submission for an item. Returns {correct:bool, points, expected}.
     For 'short' (written) items returns {needsAI:true} — graded elsewhere. */
  function grade(genId, seed, submitted, cfg) {
    var q = generate(genId, seed, cfg);
    if (!q) { return { error: "unknown item" }; }
    if (q.kind === "short") { return { needsAI: true, points: q.points }; }
    if (q.kind === "mc") {
      var pick = parseInt(submitted, 10);
      var ok = (pick === q.answer);
      return { correct: ok, points: ok ? q.points : 0, expected: q.answer };
    }
    /* numeric */
    var val = parseFloat(submitted);
    var tol = (typeof q.tolerance === "number") ? q.tolerance : 0.01;
    var good = !isNaN(val) && Math.abs(val - q.answer) <= tol;
    return { correct: good, points: good ? q.points : 0, expected: q.answer };
  }

  function listGenerators() {
    var out = [];
    for (var k in GEN) { if (GEN.hasOwnProperty(k)) {
      out.push({ id: k, chapter: GEN[k].chapter, kind: GEN[k].kind, render: GEN[k].render, difficulty: GEN[k].difficulty });
    } }
    STATIC.forEach(function (s) { out.push({ id: s.id, chapter: s.chapter, kind: s.kind, render: s.render, difficulty: s.difficulty, static: true }); });
    return out;
  }

  global.IMGenerators = { generate: generate, grade: grade, list: listGenerators };
})(this);
