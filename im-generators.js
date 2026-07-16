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


  /* ==================== GRAPHICAL GENERATORS (Ch3-Ch10) ==================== */

  /* ---- Ch3: opportunity cost from a PPF (graphical) --------------------- */
  GEN["ch3_ppf_oppcost_graph"] = {
    id: "ch3_ppf_oppcost_graph", chapter: 3, kind: "numeric", render: "graphical",
    difficulty: "med", concept: "PPF opportunity cost (graph)", points: 2,
    build: function (rng) {
      var k = rng_pick(rng, [1, 2, 3]); var xmax = rng_int(rng, 6, 9); var ymax = k * xmax;
      var x1 = rng_int(rng, 1, 2), x2 = rng_int(rng, 4, 6);
      var y1 = ymax - k * x1, y2 = ymax - k * x2;
      return {
        prompt: "This country's PPF is a straight line. Moving from point A (" + x1 + " of X, " + y1 +
          " of Y) to point B (" + x2 + " of X, " + y2 + " of Y), what is the opportunity cost of one unit of X (in units of Y)?",
        diagramSpec: { type: "ppf", xmax: xmax, ymax: ymax, xlab: "Good X", ylab: "Good Y", bow: 0,
          points: [{ x: x1, y: y1, label: "A", state: "on" }, { x: x2, y: y2, label: "B", state: "on" }] },
        answer: k, tolerance: 0.01,
        rationale: "Along a straight PPF the opportunity cost is constant: (Y lost)/(X gained) = " + (y1 - y2) + "/" + (x2 - x1) + " = " + k + "."
      };
    }
  };

  /* ---- Ch3: identify efficient/inefficient/unattainable point (graphical MC) */
  GEN["ch3_ppf_point_type"] = {
    id: "ch3_ppf_point_type", chapter: 3, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "PPF: interpreting points economically", points: 2,
    build: function (rng) {
      var xmax = rng_int(rng, 8, 10), ymax = rng_int(rng, 8, 10);
      var kind = rng_pick(rng, [0, 1, 2]); /* 0 inside, 1 on, 2 outside */
      var px = rng_int(rng, 3, 5), py, state;
      var onY = window.IMDiagrams.ppfY({ xmax: xmax, ymax: ymax, bow: 0.28 }, px);
      if (kind === 0) { py = Math.max(1, Math.round(onY - rng_int(rng, 2, 3))); state = "inside"; }
      else if (kind === 1) { py = onY; state = "on"; }
      else { py = Math.min(ymax, Math.round(onY + rng_int(rng, 2, 3))); state = "outside"; }
      /* harder: ask what the point IMPLIES about the economy, not just its name */
      var optsByKind = [
        /* inside */["Some resources are idle or misallocated \u2014 the economy could make more of both goods",
          "The economy is using all resources efficiently", "This output is impossible to achieve", "The two goods have no opportunity cost"],
        /* on */["Producing more of one good now requires giving up some of the other",
          "The economy is wasting resources", "More of both goods can be produced with no tradeoff", "This point cannot be reached"],
        /* outside */["The economy cannot reach this point without more resources or better technology",
          "The economy is producing efficiently here", "Resources are being wasted", "This point is inside the frontier"]
      ];
      var opts = optsByKind[kind];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "Point P is marked relative to this economy's production possibilities frontier. Which statement correctly describes what point P implies?",
        diagramSpec: { type: "ppf", xmax: xmax, ymax: ymax, xlab: "Good X", ylab: "Good Y", bow: 0.28,
          points: [{ x: px, y: py, label: "P", state: state }] },
        options: sh.options, answer: sh.correctIndex,
        rationale: state === "inside" ? "A point inside the frontier signals inefficiency \u2014 idle or poorly-allocated resources; the economy could produce more of both goods." :
          state === "on" ? "A point on the frontier is efficient: with all resources used, producing more of one good forces a sacrifice of the other (opportunity cost)." :
          "A point beyond the frontier is currently unattainable \u2014 it would require more resources or improved technology (growth)."
      };
    }
  };

  /* ---- Ch4: read equilibrium quantity off the graph (graphical numeric) - */
  GEN["ch4_read_eq_quantity"] = {
    id: "ch4_read_eq_quantity", chapter: 4, kind: "numeric", render: "graphical",
    difficulty: "med", concept: "reading equilibrium (graph)", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 3, 7), c = rng_int(rng, 1, 4);
      var pStar = c + d * qStar, a = pStar + b * qStar;
      return {
        prompt: "Read the equilibrium quantity from the supply-and-demand graph.",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true,
          qmax: Math.max(10, qStar + 3), pmax: Math.max(12, pStar + 3) },
        answer: qStar, tolerance: 0.01,
        rationale: "The curves cross at Q* = " + qStar + " (where quantity demanded equals quantity supplied)."
      };
    }
  };

  /* ---- Ch4: predict effect of a shift, shown graphically (graphical MC) -- */
  GEN["ch4_shift_graph_effect"] = {
    id: "ch4_shift_graph_effect", chapter: 4, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "shift effect (graph)", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 4, 6), c = rng_int(rng, 1, 3);
      var pStar = c + d * qStar, a = pStar + b * qStar;
      var which = rng_pick(rng, ["demand", "supply"]);
      var shiftBy = rng_pick(rng, [2, 3, 4]);
      /* demand right (+): P up, Q up; supply right (+): P down, Q up */
      var pUp = which === "demand"; var qUp = true;
      var opts = ["Equilibrium price and quantity both rise",
        "Price rises, quantity falls", "Price falls, quantity rises", "Price and quantity both fall"];
      var correct = (pUp && qUp) ? 0 : (!pUp && qUp) ? 2 : 1;
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "The graph shows the " + which + " curve shifting to the right (D\u2081\u2192D\u2082 or S\u2081\u2192S\u2082). What happens to the equilibrium price and quantity?",
        diagramSpec: { type: "shift", dA: a, dB: -b, sA: c, sB: d, which: which, shiftBy: shiftBy,
          qmax: Math.max(12, qStar + 5), pmax: Math.max(14, a + 2), hideValues: true },
        options: sh.options, answer: sh.correctIndex,
        rationale: which === "demand" ?
          "A rightward demand shift raises both equilibrium price and quantity." :
          "A rightward supply shift lowers price but raises quantity."
      };
    }
  };

  /* ---- Ch5: classify elasticity from steep vs flat demand (graphical MC) - */
  GEN["ch5_steep_flat_graph"] = {
    id: "ch5_steep_flat_graph", chapter: 5, kind: "mc", render: "graphical",
    difficulty: "med", concept: "elastic vs inelastic (graph)", points: 2,
    build: function (rng) {
      var steep = rng() < 0.5;
      /* steep demand (large |slope|) = inelastic-looking; flat = elastic-looking */
      var b = steep ? 3 : 1;   /* demand slope magnitude */
      var a = rng_int(rng, 14, 20);
      var opts = ["relatively inelastic (steep)", "relatively elastic (flat)"];
      var correct = steep ? 0 : 1;
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "Compared with a typical demand curve, the demand curve shown is " + (steep ? "steep" : "flat") +
          ". This suggests demand is:",
        diagramSpec: { type: "elasticity", a: a, b: -b, qmax: Math.floor(a / b) + 2, pmax: a + 2,
          label: "D" },
        options: sh.options, answer: sh.correctIndex,
        rationale: "A steep demand curve means quantity changes little when price changes (inelastic); a flat one means quantity is very responsive (elastic)."
      };
    }
  };

  /* ---- Ch5: total revenue at equilibrium (graphical numeric) ------------ */
  GEN["ch5_revenue_box_graph"] = {
    id: "ch5_revenue_box_graph", chapter: 5, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "total revenue (graph)", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 3, 6), c = rng_int(rng, 1, 3);
      var pStar = c + d * qStar, a = pStar + b * qStar;
      var rev = pStar * qStar;
      return {
        prompt: "At the equilibrium shown, total revenue is price \u00d7 quantity (the shaded rectangle). Compute total revenue.",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true, showRevenueBox: true,
          qmax: Math.max(10, qStar + 3), pmax: Math.max(12, pStar + 3) },
        answer: rev, tolerance: 0.01,
        rationale: "Total revenue = P* \u00d7 Q* = " + pStar + " \u00d7 " + qStar + " = " + rev + "."
      };
    }
  };

  /* ---- Ch6: tax incidence split shown graphically (graphical numeric) --- */
  GEN["ch6_tax_buyer_price_graph"] = {
    id: "ch6_tax_buyer_price_graph", chapter: 6, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "tax buyer price (graph)", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 5, 8), c = rng_int(rng, 1, 3);
      var pStar = c + d * qStar, a = pStar + b * qStar;
      var tax = rng_int(rng, 2, 5);
      var qt = (a - c - tax) / (b + d);
      var pb = a - b * qt;   /* price buyers pay */
      return {
        prompt: "A per-unit tax of $" + tax + " is imposed on this market (demand P = " + a + " \u2212 " + fmtCoef(b) +
          "Q, supply P = " + c + " + " + fmtCoef(d) + "Q). What price do BUYERS end up paying? (2 decimals)",
        diagramSpec: { type: "tax", dA: a, dB: -b, sA: c, sB: d, tax: tax,
          qmax: Math.max(10, qStar + 4), pmax: Math.max(12, a + tax + 1) },
        answer: round2(pb), tolerance: 0.1,
        rationale: "New quantity Q_t = " + round2(qt) + "; buyers pay the demand price there: P_b = " + a + " \u2212 " + fmtCoef(b) + "\u00d7" + round2(qt) + " = " + round2(pb) + "."
      };
    }
  };

  /* ---- Ch6: price floor surplus read (graphical numeric) ---------------- */
  GEN["ch6_floor_surplus_graph2"] = {
    id: "ch6_floor_surplus_graph2", chapter: 6, kind: "numeric", render: "graphical",
    difficulty: "med", concept: "price floor surplus (graph)", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 5, 8), c = rng_int(rng, 1, 3);
      var pStar = c + d * qStar, a = pStar + b * qStar;
      var floor = pStar + rng_int(rng, 2, 4);
      var qd = (a - floor) / b, qs = (floor - c) / d;
      return {
        prompt: "The graph shows a price floor of $" + floor + ". Read/compute the surplus (Qs \u2212 Qd) it creates.",
        diagramSpec: { type: "price_control", dA: a, dB: -b, sA: c, sB: d, control: "floor", level: floor,
          qmax: Math.max(10, qStar + 4), pmax: Math.max(12, a + 1) },
        answer: round2(qs - qd), tolerance: 0.1,
        rationale: "At P=" + floor + ": Qs = " + round2(qs) + ", Qd = " + round2(qd) + ", surplus = " + round2(qs - qd) + "."
      };
    }
  };

  /* ---- Ch7: consumer surplus area from a graph (graphical numeric) ------ */
  GEN["ch7_cs_area_graph"] = {
    id: "ch7_cs_area_graph", chapter: 7, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "consumer surplus area (graph)", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 3, 7), c = rng_int(rng, 1, 4);
      var pStar = c + d * qStar, a = pStar + b * qStar;
      var cs = 0.5 * qStar * (a - pStar);
      return {
        prompt: "Using the shaded consumer-surplus triangle, compute consumer surplus at equilibrium. (Demand P = " + a + " \u2212 " + fmtCoef(b) + "Q, supply P = " + c + " + " + fmtCoef(d) + "Q.)",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true, shade: "surplus",
          qmax: Math.max(10, qStar + 3), pmax: Math.max(12, a + 1) },
        answer: round2(cs), tolerance: 0.5,
        rationale: "CS = \u00bd \u00d7 Q* \u00d7 (demand intercept \u2212 P*) = \u00bd \u00d7 " + qStar + " \u00d7 (" + a + " \u2212 " + pStar + ") = " + round2(cs) + "."
      };
    }
  };

  /* ---- Ch7: total surplus AND the efficient-quantity insight (harder) --- */
  GEN["ch7_total_surplus_graph"] = {
    id: "ch7_total_surplus_graph", chapter: 7, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "total surplus + efficiency reasoning", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 4, 7), c = rng_int(rng, 1, 4);
      var pStar = c + d * qStar, a = pStar + b * qStar;
      var tsMax = 0.5 * qStar * (a - c);
      /* harder: total surplus if output were CAPPED at q' < q* (e.g., a quota).
         TS(q') = area under demand minus area under supply from 0 to q'.
         = integral: (a - c)*q' - 0.5*(b+d)*q'^2  */
      var qCap = qStar - rng_int(rng, 1, 2);
      var tsCap = (a - c) * qCap - 0.5 * (b + d) * qCap * qCap;
      return {
        prompt: "In this market, demand is P = " + a + " \u2212 " + fmtCoef(b) + "Q and supply is P = " + c + " + " +
          fmtCoef(d) + "Q. Suppose a quota limits output to only " + qCap + " units (below the equilibrium quantity). Compute the TOTAL surplus actually realized at that restricted quantity. (2 decimals)",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true, shade: "surplus",
          qmax: Math.max(10, qStar + 3), pmax: Math.max(12, a + 1) },
        answer: round2(tsCap), tolerance: 0.2,
        rationale: "Total surplus at quantity q = (demand height \u2212 supply height) summed over units = (a\u2212c)\u00b7q \u2212 \u00bd(b+d)\u00b7q\u00b2 = (" +
          (a - c) + ")\u00b7" + qCap + " \u2212 \u00bd\u00b7" + (b + d) + "\u00b7" + qCap + "\u00b2 = " + round2(tsCap) +
          ". (This is less than the maximum " + round2(tsMax) + " at the efficient quantity " + qStar + " \u2014 the shortfall is deadweight loss from underproduction.)"
      };
    }
  };

  /* ---- Ch8: deadweight loss area from a graph (graphical numeric) ------- */
  GEN["ch8_dwl_area_graph"] = {
    id: "ch8_dwl_area_graph", chapter: 8, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "deadweight loss area (graph)", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 5, 8), c = rng_int(rng, 1, 3);
      var pStar = c + d * qStar, a = pStar + b * qStar;
      var tax = rng_int(rng, 2, 5);
      var qt = (a - c - tax) / (b + d);
      var dwl = 0.5 * tax * (qStar - qt);
      return {
        prompt: "The shaded triangle is the deadweight loss from a $" + tax + " tax. Compute its area. (Demand P = " + a + " \u2212 " + fmtCoef(b) + "Q, supply P = " + c + " + " + fmtCoef(d) + "Q.)",
        diagramSpec: { type: "tax", dA: a, dB: -b, sA: c, sB: d, tax: tax,
          qmax: Math.max(10, qStar + 4), pmax: Math.max(12, a + tax + 1) },
        answer: round2(dwl), tolerance: 0.2,
        rationale: "DWL = \u00bd \u00d7 tax \u00d7 (Q* \u2212 Q_t) = \u00bd \u00d7 " + tax + " \u00d7 (" + qStar + " \u2212 " + round2(qt) + ") = " + round2(dwl) + "."
      };
    }
  };

  /* ---- Ch8: compare DWL for elastic vs inelastic (graphical MC) --------- */
  GEN["ch8_dwl_compare_graph"] = {
    id: "ch8_dwl_compare_graph", chapter: 8, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "DWL and elasticity (graph)", points: 2,
    build: function (rng) {
      /* show a market; ask which curve shape gives bigger DWL for same tax */
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 5, 7), c = rng_int(rng, 1, 3);
      var pStar = c + d * qStar, a = pStar + b * qStar;
      var tax = 4;
      var opts = ["when supply and demand are more elastic (flatter)",
        "when supply and demand are more inelastic (steeper)",
        "the deadweight loss is the same regardless of elasticity",
        "only when the tax is small"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "For the tax shown, the deadweight loss would be LARGER:",
        diagramSpec: { type: "tax", dA: a, dB: -b, sA: c, sB: d, tax: tax,
          qmax: Math.max(10, qStar + 4), pmax: Math.max(12, a + tax + 1) },
        options: sh.options, answer: sh.correctIndex,
        rationale: "More elastic (flatter) curves mean quantity falls more when the tax is imposed, so more trades are lost and DWL is larger."
      };
    }
  };

  /* ---- Ch9: read the efficient scale from cost curves (graphical MC) ----- */
  GEN["ch9_efficient_scale_graph"] = {
    id: "ch9_efficient_scale_graph", chapter: 9, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "efficient scale (graph)", points: 2,
    build: function (rng) {
      var fc = rng_pick(rng, [18, 20, 24]); var a = rng_pick(rng, [10, 11]);
      var b = rng_pick(rng, [2.0, 2.2]); var c = rng_pick(rng, [0.16, 0.18, 0.2]);
      var opts = ["at the minimum point of the ATC curve (where MC crosses ATC)",
        "at the minimum point of the MC curve", "where AVC equals fixed cost",
        "at the largest possible quantity"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "On the cost-curve diagram, the firm's EFFICIENT SCALE (lowest average total cost) is:",
        diagramSpec: { type: "cost_curves", fc: fc, a: a, b: b, c: c, showATC: true, showAVC: true },
        options: sh.options, answer: sh.correctIndex,
        rationale: "Efficient scale is the quantity minimizing ATC \u2014 exactly where the marginal-cost curve intersects the ATC curve."
      };
    }
  };

  /* ---- Ch9: which curve is which (graphical MC) ------------------------- */
  /* ---- Ch9: compute a cost value by reading the curves (harder numeric) - */
  GEN["ch9_identify_curve_graph"] = {
    id: "ch9_identify_curve_graph", chapter: 9, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "average fixed cost from ATC and AVC", points: 3,
    build: function (rng) {
      /* Cost model used by the diagram: VC = a*q - b*q^2 + c*q^3 (here a=10,b=2.2,c=0.18),
         but for a clean student computation we pose it in words with round numbers:
         at a given quantity the student is told ATC and AVC; AFC = ATC - AVC, and
         total fixed cost = AFC * q. */
      var q = rng_int(rng, 4, 8);
      var avc = rng_int(rng, 6, 12);
      var afc = rng_int(rng, 3, 8);
      var atc = avc + afc;
      var tfc = afc * q;
      return {
        prompt: "The diagram shows a firm's U-shaped cost curves. At an output of " + q + " units, the ATC curve reads $" +
          atc + " and the AVC curve reads $" + avc + ". Using the diagram's logic, what is the firm's TOTAL FIXED COST? (Hint: the vertical gap between ATC and AVC is average fixed cost.)",
        diagramSpec: { type: "cost_curves", fc: 20, a: 10, b: 2.2, c: 0.18, showATC: true, showAVC: true },
        answer: tfc, tolerance: 0.01,
        rationale: "Average fixed cost = ATC \u2212 AVC = $" + atc + " \u2212 $" + avc + " = $" + afc + ". Total fixed cost = AFC \u00d7 Q = $" +
          afc + " \u00d7 " + q + " = $" + tfc + "."
      };
    }
  };

  /* ---- Ch10: profit-max quantity from cost curves + price (graphical numeric) */
  GEN["ch10_profit_max_graph"] = {
    id: "ch10_profit_max_graph", chapter: 10, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "profit maximization (graph)", points: 2,
    build: function (rng) {
      var price = rng_int(rng, 12, 20);
      var opts = ["where the price line crosses the marginal-cost curve (P = MC)",
        "where the price line crosses the ATC curve", "at the minimum of ATC",
        "where price crosses the AVC curve"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "Given the market price shown (dashed line = P = MR), the firm maximizes profit by producing the quantity:",
        diagramSpec: { type: "cost_curves", fc: 24, a: 10, b: 2.2, c: 0.18, showATC: true, showAVC: true, price: price },
        options: sh.options, answer: sh.correctIndex,
        rationale: "A competitive firm produces where price (= marginal revenue) equals marginal cost, on the rising part of MC."
      };
    }
  };

  /* ---- Ch10: profit or loss identification (graphical MC) --------------- */
  GEN["ch10_profit_loss_graph"] = {
    id: "ch10_profit_loss_graph", chapter: 10, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "profit vs loss (graph)", points: 2,
    build: function (rng) {
      /* price above min ATC (~6.8 for default coeffs) => profit; below => loss */
      var profit = rng() < 0.5;
      var price = profit ? rng_int(rng, 12, 18) : rng_int(rng, 4, 6);
      var opts = ["earning a profit (price above average total cost at q*)",
        "incurring a loss (price below average total cost at q*)",
        "earning exactly zero profit", "shutting down immediately"];
      var correct = profit ? 0 : 1;
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "At the profit-maximizing quantity shown (shaded rectangle), the firm is:",
        diagramSpec: { type: "cost_curves", fc: 24, a: 10, b: 2.2, c: 0.18, showATC: true, showAVC: true, price: price, showProfit: true },
        options: sh.options, answer: sh.correctIndex,
        rationale: profit ?
          "The price line lies above ATC at q*, so the shaded rectangle is a profit." :
          "The price line lies below ATC at q*, so the shaded rectangle is a loss."
      };
    }
  };

  /* ---- extra graphical to reach 5 per chapter ---- */

  /* Ch3: comparative advantage from two PPFs shown as slopes (numeric) */
  GEN["ch3_ppf_slope_oppcost"] = {
    id: "ch3_ppf_slope_oppcost", chapter: 3, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "opportunity cost from PPF slope", points: 2,
    build: function (rng) {
      var k = rng_pick(rng, [1, 2, 3]); var xmax = rng_int(rng, 6, 8); var ymax = k * xmax;
      return {
        prompt: "A country's straight-line PPF runs from (0, " + ymax + ") on the Y-axis to (" + xmax + ", 0) on the X-axis. What is the opportunity cost of ONE unit of good X, in units of Y?",
        diagramSpec: { type: "ppf", xmax: xmax, ymax: ymax, xlab: "Good X", ylab: "Good Y", bow: 0,
          points: [{ x: 0, y: ymax, label: "", state: "on" }, { x: xmax, y: 0, label: "", state: "on" }] },
        answer: k, tolerance: 0.01,
        rationale: "Slope magnitude = Y-intercept / X-intercept = " + ymax + "/" + xmax + " = " + k + " units of Y per unit of X."
      };
    }
  };

  /* Ch3: increasing opportunity cost along a bowed PPF (hard application) */
  GEN["ch3_ppf_efficient_point"] = {
    id: "ch3_ppf_efficient_point", chapter: 3, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "increasing opportunity cost (bowed PPF)", points: 3,
    build: function (rng) {
      var xmax = rng_int(rng, 9, 10), ymax = rng_int(rng, 9, 10);
      var spec = { xmax: xmax, ymax: ymax, bow: 0.28 };
      /* two points at low-x and high-x regions, both on the frontier */
      var xa = 1, xb = xmax - 2;
      var ya = window.IMDiagrams.ppfY(spec, xa), yb = window.IMDiagrams.ppfY(spec, xb);
      /* moving one more unit of X near A costs less Y than near B (bowed out => increasing OC) */
      var opts = ["The opportunity cost of producing more X rises as the economy moves from A toward B",
        "The opportunity cost of X is constant along the whole frontier",
        "The opportunity cost of producing more X falls as the economy moves from A toward B",
        "Producing more X has no opportunity cost"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "This economy's PPF is bowed outward. Points A (low X) and B (high X) both lie on the frontier. What does the bowed shape tell you about the opportunity cost of good X as the economy shifts from A toward B?",
        diagramSpec: { type: "ppf", xmax: xmax, ymax: ymax, xlab: "Good X", ylab: "Good Y", bow: 0.28,
          points: [{ x: xa, y: ya, label: "A", state: "on" }, { x: xb, y: yb, label: "B", state: "on" }] },
        options: sh.options, answer: sh.correctIndex,
        rationale: "A bowed-out (concave) PPF reflects INCREASING opportunity cost: as resources ill-suited to X are pulled into producing it, each additional unit of X costs more Y \u2014 the frontier gets steeper moving from A toward B."
      };
    }
  };

  /* Ch4: read equilibrium PRICE off graph (numeric) */
  GEN["ch4_read_eq_price"] = {
    id: "ch4_read_eq_price", chapter: 4, kind: "numeric", render: "graphical",
    difficulty: "med", concept: "reading equilibrium price (graph)", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 3, 7), c = rng_int(rng, 1, 4);
      var pStar = c + d * qStar, a = pStar + b * qStar;
      return {
        prompt: "Read the equilibrium PRICE from the supply-and-demand graph.",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true,
          qmax: Math.max(10, qStar + 3), pmax: Math.max(12, pStar + 3) },
        answer: pStar, tolerance: 0.01,
        rationale: "The curves cross at P* = " + pStar + "."
      };
    }
  };

  /* Ch5: elasticity along a linear demand curve (graphical MC) */
  GEN["ch5_linear_elasticity_graph"] = {
    id: "ch5_linear_elasticity_graph", chapter: 5, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "elasticity along linear demand", points: 2,
    build: function (rng) {
      var a = rng_int(rng, 14, 20);
      var opts = ["more elastic near the top (high price) and less elastic near the bottom",
        "constant everywhere along the curve", "more elastic near the bottom (low price)",
        "always perfectly inelastic"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "For the straight-line demand curve shown, how does price elasticity of demand vary along it?",
        diagramSpec: { type: "elasticity", a: a, b: -1, qmax: a + 2, pmax: a + 2, label: "D" },
        options: sh.options, answer: sh.correctIndex,
        rationale: "Even with constant slope, a linear demand curve is elastic at high prices (top) and inelastic at low prices (bottom)."
      };
    }
  };

  /* Ch5: which curve is more elastic (graphical MC) */
  GEN["ch5_compare_slopes_graph"] = {
    id: "ch5_compare_slopes_graph", chapter: 5, kind: "mc", render: "graphical",
    difficulty: "med", concept: "comparing elasticity (graph)", points: 2,
    build: function (rng) {
      var flat = rng() < 0.5;
      var b = flat ? 1 : 3;
      var a = rng_int(rng, 12, 18);
      var opts = ["a flatter demand curve is more elastic", "a steeper demand curve is more elastic",
        "slope has nothing to do with elasticity", "both curves have the same elasticity everywhere"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "The demand curve shown has a particular steepness. As a general rule, comparing two demand curves through the same point:",
        diagramSpec: { type: "elasticity", a: a, b: -b, qmax: Math.floor(a / b) + 2, pmax: a + 2, label: "D" },
        options: sh.options, answer: sh.correctIndex,
        rationale: "Through a common point, the flatter demand curve is the more elastic one (quantity responds more to price)."
      };
    }
  };

  /* Ch7: producer surplus area from graph (numeric) */
  GEN["ch7_ps_area_graph"] = {
    id: "ch7_ps_area_graph", chapter: 7, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "producer surplus area (graph)", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 3, 7), c = rng_int(rng, 1, 4);
      var pStar = c + d * qStar, a = pStar + b * qStar;
      var ps = 0.5 * qStar * (pStar - c);
      return {
        prompt: "Using the shaded producer-surplus region, compute producer surplus at equilibrium.",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true, shade: "surplus",
          qmax: Math.max(10, qStar + 3), pmax: Math.max(12, a + 1) },
        answer: round2(ps), tolerance: 0.5,
        rationale: "PS = \u00bd \u00d7 Q* \u00d7 (P* \u2212 supply intercept) = \u00bd \u00d7 " + qStar + " \u00d7 (" + pStar + " \u2212 " + c + ") = " + round2(ps) + "."
      };
    }
  };

  /* Ch8: tax revenue rectangle area from graph (numeric) */
  GEN["ch8_revenue_area_graph"] = {
    id: "ch8_revenue_area_graph", chapter: 8, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "tax revenue area (graph)", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 5, 8), c = rng_int(rng, 1, 3);
      var pStar = c + d * qStar, a = pStar + b * qStar;
      var tax = rng_int(rng, 2, 5);
      var qt = (a - c - tax) / (b + d);
      return {
        prompt: "The shaded rectangle is the government's tax revenue from a $" + tax + " tax. Compute it. (Demand P = " + a + " \u2212 " + fmtCoef(b) + "Q, supply P = " + c + " + " + fmtCoef(d) + "Q.)",
        diagramSpec: { type: "tax", dA: a, dB: -b, sA: c, sB: d, tax: tax, showRevenue: true,
          qmax: Math.max(10, qStar + 4), pmax: Math.max(12, a + tax + 1) },
        answer: round2(tax * qt), tolerance: 0.2,
        rationale: "Revenue = tax \u00d7 Q_t = " + tax + " \u00d7 " + round2(qt) + " = " + round2(tax * qt) + "."
      };
    }
  };

  /* Ch9: MC-ATC crossing identification (graphical MC) */
  GEN["ch9_mc_crosses_atc_graph"] = {
    id: "ch9_mc_crosses_atc_graph", chapter: 9, kind: "mc", render: "graphical",
    difficulty: "med", concept: "MC crosses ATC (graph)", points: 2,
    build: function (rng) {
      var fc = rng_pick(rng, [18, 20, 24]);
      var opts = ["at the minimum of the ATC curve", "at the maximum of the ATC curve",
        "where ATC meets the vertical axis", "where MC is at its own minimum"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "In the cost-curve diagram, the marginal-cost curve intersects the average-total-cost curve:",
        diagramSpec: { type: "cost_curves", fc: fc, a: 10, b: 2.2, c: 0.18, showATC: true, showAVC: true },
        options: sh.options, answer: sh.correctIndex,
        rationale: "MC crosses ATC at ATC's minimum: below it MC pulls the average down, above it MC pushes the average up."
      };
    }
  };

  /* Ch10: shutdown decision from graph (graphical MC) */
  GEN["ch10_shutdown_graph"] = {
    id: "ch10_shutdown_graph", chapter: 10, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "shutdown from graph", points: 2,
    build: function (rng) {
      /* AVC min ~ 3.3 for default coeffs; price below that -> shut down */
      var shut = rng() < 0.5;
      var price = shut ? 2 : rng_int(rng, 8, 14);
      var opts = ["keep producing \u2014 price is at or above minimum AVC", "shut down \u2014 price is below minimum AVC"];
      var correct = shut ? 1 : 0;
      var sh = shuffleWithAnswer(rng, opts, correct);
      return {
        prompt: "Given the market price shown (dashed line), in the SHORT RUN the firm should:",
        diagramSpec: { type: "cost_curves", fc: 24, a: 10, b: 2.2, c: 0.18, showATC: true, showAVC: true, price: price },
        options: sh.options, answer: sh.correctIndex,
        rationale: shut ?
          "The price is below the minimum of AVC, so the firm loses less by shutting down." :
          "The price is at or above minimum AVC, so the firm should keep producing in the short run."
      };
    }
  };

  /* ---- final gap-fillers ---- */

  /* Ch3: read production tradeoff from PPF (numeric) */
  GEN["ch3_ppf_tradeoff_graph"] = {
    id: "ch3_ppf_tradeoff_graph", chapter: 3, kind: "numeric", render: "graphical",
    difficulty: "med", concept: "PPF tradeoff (graph)", points: 2,
    build: function (rng) {
      var k = rng_pick(rng, [1, 2]); var xmax = rng_int(rng, 7, 9); var ymax = k * xmax;
      var x1 = rng_int(rng, 1, 2), x2 = x1 + rng_int(rng, 2, 3);
      var y1 = ymax - k * x1, y2 = ymax - k * x2;
      return {
        prompt: "Moving from A (" + x1 + " of X, " + y1 + " of Y) to B (" + x2 + " of X, " + y2 + " of Y) along the PPF, how many units of Y must be given up in total?",
        diagramSpec: { type: "ppf", xmax: xmax, ymax: ymax, xlab: "Good X", ylab: "Good Y", bow: 0,
          points: [{ x: x1, y: y1, label: "A", state: "on" }, { x: x2, y: y2, label: "B", state: "on" }] },
        answer: y1 - y2, tolerance: 0.01,
        rationale: "Y given up = " + y1 + " \u2212 " + y2 + " = " + (y1 - y2) + " units."
      };
    }
  };

  /* Ch5: total revenue change interpretation from graph (MC) */
  GEN["ch5_revenue_interpret_graph"] = {
    id: "ch5_revenue_interpret_graph", chapter: 5, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "revenue rectangle interpretation", points: 2,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var qStar = rng_int(rng, 3, 6), c = rng_int(rng, 1, 3);
      var pStar = c + d * qStar, a = pStar + b * qStar;
      var opts = ["the area of the rectangle equals price times quantity (total revenue)",
        "the area equals consumer surplus", "the area equals the deadweight loss",
        "the area equals producer surplus only"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "The shaded rectangle in the diagram represents:",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true, showRevenueBox: true,
          qmax: Math.max(10, qStar + 3), pmax: Math.max(12, pStar + 3) },
        options: sh.options, answer: sh.correctIndex,
        rationale: "The rectangle with height P* and width Q* has area P* \u00d7 Q* = total revenue."
      };
    }
  };

  /* Ch9: read that AFC keeps falling (conceptual graphical MC) */
  GEN["ch9_avc_below_atc_graph"] = {
    id: "ch9_avc_below_atc_graph", chapter: 9, kind: "mc", render: "graphical",
    difficulty: "med", concept: "AVC vs ATC gap (graph)", points: 2,
    build: function (rng) {
      var fc = rng_pick(rng, [18, 20, 24]);
      var opts = ["the vertical gap between ATC and AVC is average fixed cost, which shrinks as output rises",
        "ATC and AVC are always equal", "AVC lies above ATC",
        "the gap between them grows without limit"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "In the diagram, what does the vertical distance between the ATC and AVC curves represent, and how does it change as output rises?",
        diagramSpec: { type: "cost_curves", fc: fc, a: 10, b: 2.2, c: 0.18, showATC: true, showAVC: true },
        options: sh.options, answer: sh.correctIndex,
        rationale: "ATC \u2212 AVC = average fixed cost = FC/Q, which continually shrinks as output rises (the curves converge)."
      };
    }
  };

  /* Ch10: zero-profit long-run (graphical MC) */
  GEN["ch10_zero_profit_graph"] = {
    id: "ch10_zero_profit_graph", chapter: 10, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "long-run zero profit (graph)", points: 2,
    build: function (rng) {
      /* price set at min ATC (~6.8) => zero economic profit */
      var opts = ["price equals the minimum of ATC, so economic profit is zero",
        "price is above ATC, so there is a profit", "price is below AVC, so the firm shuts down",
        "the firm earns a large profit"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "In long-run competitive equilibrium, the price line just touches the bottom of the ATC curve. This means:",
        diagramSpec: { type: "cost_curves", fc: 24, a: 10, b: 2.2, c: 0.18, showATC: true, showAVC: true, price: 7 },
        options: sh.options, answer: sh.correctIndex,
        rationale: "When price equals minimum ATC, revenue exactly covers all costs (including opportunity cost): zero economic profit \u2014 the long-run outcome."
      };
    }
  };

  /* Ch10: price-taker firm demand (graphical MC) */
  GEN["ch10_firm_demand_graph"] = {
    id: "ch10_firm_demand_graph", chapter: 10, kind: "mc", render: "graphical",
    difficulty: "med", concept: "price-taker marginal revenue", points: 2,
    build: function (rng) {
      var price = rng_int(rng, 10, 16);
      var opts = ["a horizontal line at the market price (the firm is a price taker)",
        "a downward-sloping curve", "the same as the ATC curve", "vertical at the efficient scale"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "For the competitive firm shown, the demand curve it faces (its marginal revenue) is:",
        diagramSpec: { type: "cost_curves", fc: 24, a: 10, b: 2.2, c: 0.18, showATC: true, showAVC: true, price: price },
        options: sh.options, answer: sh.correctIndex,
        rationale: "A competitive firm is a price taker: it can sell any quantity at the market price, so its demand (= MR) is a horizontal line at that price."
      };
    }
  };


  /* ==================== CHAPTER 11 — Monopoly (graphical) ============== */

  /* Ch11: find monopoly quantity where MR=MC (graphical numeric) */
  GEN["ch11_monopoly_quantity"] = {
    id: "ch11_monopoly_quantity", chapter: 11, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "monopoly output MR=MC", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]);
      var mc0 = rng_int(rng, 2, 5);
      var qm = rng_int(rng, 3, 7);           /* choose Qm integer, back out a */
      var a = mc0 + 2 * b * qm;               /* so MR=MC at qm exactly */
      return {
        prompt: "A monopolist faces demand P = " + a + " \u2212 " + fmtCoef(b) + "Q with constant marginal cost MC = " +
          mc0 + ". Using MR = MC (recall MR = " + a + " \u2212 " + fmtCoef(2 * b) + "Q), find the profit-maximizing quantity.",
        diagramSpec: { type: "monopoly", a: a, b: b, mc0: mc0, qmax: Math.round((a - mc0) / b) + 2, pmax: a + 2, showCompetitive: true },
        answer: qm, tolerance: 0.01,
        rationale: "Set MR = MC: " + a + " \u2212 " + fmtCoef(2 * b) + "Q = " + mc0 + " \u2192 Q = (" + a + "\u2212" + mc0 + ")/" + (2 * b) + " = " + qm + "."
      };
    }
  };

  /* Ch11: monopoly price (graphical numeric) */
  GEN["ch11_monopoly_price"] = {
    id: "ch11_monopoly_price", chapter: 11, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "monopoly price from demand", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]);
      var mc0 = rng_int(rng, 2, 5);
      var qm = rng_int(rng, 3, 6);
      var a = mc0 + 2 * b * qm;
      var pm = a - b * qm;                     /* price up on demand at Qm */
      return {
        prompt: "A monopolist faces demand P = " + a + " \u2212 " + fmtCoef(b) + "Q with MC = " + mc0 +
          ". After finding the profit-maximizing quantity (where MR = MC), what PRICE does the monopolist charge? (Read the price up on the demand curve.)",
        diagramSpec: { type: "monopoly", a: a, b: b, mc0: mc0, qmax: Math.round((a - mc0) / b) + 2, pmax: a + 2 },
        answer: pm, tolerance: 0.01,
        rationale: "Qm = " + qm + " (from MR=MC). The monopoly price is the demand height at Qm: P = " + a + " \u2212 " + fmtCoef(b) + "\u00d7" + qm + " = " + pm + " (above MC \u2014 a markup)."
      };
    }
  };

  /* Ch11: monopoly deadweight loss (graphical numeric) */
  GEN["ch11_monopoly_dwl"] = {
    id: "ch11_monopoly_dwl", chapter: 11, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "monopoly deadweight loss", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]);
      var mc0 = rng_int(rng, 2, 4);
      var qm = rng_int(rng, 3, 5);
      var a = mc0 + 2 * b * qm;
      var pm = a - b * qm;
      var qc = (a - mc0) / b;                  /* competitive quantity where P=MC */
      /* DWL triangle: base (qc - qm), height (pm - mc0) */
      var dwl = 0.5 * (qc - qm) * (pm - mc0);
      return {
        prompt: "A monopolist faces demand P = " + a + " \u2212 " + fmtCoef(b) + "Q with MC = " + mc0 +
          ". The monopoly produces Q = " + qm + " while the efficient (competitive) quantity is Q = " + qc +
          ". Compute the deadweight loss (the shaded triangle). (2 decimals)",
        diagramSpec: { type: "monopoly", a: a, b: b, mc0: mc0, qmax: Math.round(qc) + 2, pmax: a + 2, showDWL: true, showCompetitive: true },
        answer: round2(dwl), tolerance: 0.2,
        rationale: "DWL = \u00bd \u00d7 (Qc \u2212 Qm) \u00d7 (Pm \u2212 MC) = \u00bd \u00d7 (" + qc + "\u2212" + qm + ") \u00d7 (" + pm + "\u2212" + mc0 + ") = " + round2(dwl) + "."
      };
    }
  };

  /* Ch11: monopoly profit from the rectangle (graphical numeric) */
  GEN["ch11_monopoly_profit"] = {
    id: "ch11_monopoly_profit", chapter: 11, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "monopoly profit", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]);
      var mc0 = rng_int(rng, 2, 4);
      var qm = rng_int(rng, 4, 6);
      var a = mc0 + 2 * b * qm;
      var pm = a - b * qm;
      var atc = rng_int(rng, mc0, pm - 1);     /* ATC between MC and Pm so there's a profit */
      var profit = (pm - atc) * qm;
      return {
        prompt: "A monopolist produces Q = " + qm + " and charges P = " + pm + " (demand P = " + a + " \u2212 " +
          fmtCoef(b) + "Q, MC = " + mc0 + "). If its average total cost at that output is " + atc +
          ", what is its profit (the shaded rectangle)?",
        diagramSpec: { type: "monopoly", a: a, b: b, mc0: mc0, atc: atc, showProfit: true, qmax: Math.round((a - mc0) / b) + 2, pmax: a + 2 },
        answer: profit, tolerance: 0.01,
        rationale: "Profit = (P \u2212 ATC) \u00d7 Q = (" + pm + " \u2212 " + atc + ") \u00d7 " + qm + " = " + profit + "."
      };
    }
  };

  /* Ch11: interpret why MR < price for a monopoly (graphical MC) */
  GEN["ch11_mr_below_demand"] = {
    id: "ch11_mr_below_demand", chapter: 11, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "why MR lies below demand", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]);
      var mc0 = rng_int(rng, 2, 5);
      var qm = rng_int(rng, 3, 6);
      var a = mc0 + 2 * b * qm;
      var opts = ["To sell one more unit the monopolist must lower the price on ALL units, so marginal revenue is less than the price",
        "The monopolist can sell extra units without lowering the price",
        "Marginal revenue equals price for a monopoly, just like perfect competition",
        "Marginal revenue is above the demand curve"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "In the diagram, the marginal-revenue (MR) curve lies BELOW the demand curve. Why?",
        diagramSpec: { type: "monopoly", a: a, b: b, mc0: mc0, qmax: Math.round((a - mc0) / b) + 2, pmax: a + 2 },
        options: sh.options, answer: sh.correctIndex,
        rationale: "A monopolist faces a downward-sloping demand curve. To sell an extra unit it must cut the price on every unit sold, so the revenue from one more unit (MR) is below the price on the demand curve."
      };
    }
  };


  /* ============ CHAPTER 12 — Monopolistic Competition (graphical) ====== */

  /* Ch12: long-run zero profit (price tangent to ATC) - reuse monopoly diagram, MC=slope */
  GEN["ch12_lr_zero_profit"] = {
    id: "ch12_lr_zero_profit", chapter: 12, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "monopolistic competition long-run", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]);
      var mc0 = rng_int(rng, 2, 4);
      var qm = rng_int(rng, 3, 6);
      var a = mc0 + 2 * b * qm;
      var pm = a - b * qm;
      var opts = ["Price equals average total cost, so economic profit is zero \u2014 the long-run outcome after entry",
        "Price is far above ATC, so the firm earns large long-run profits",
        "The firm produces at the minimum of ATC (efficient scale)",
        "Marginal revenue equals price"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "A monopolistically competitive firm faces this downward-sloping demand curve. In LONG-RUN equilibrium, the demand curve is just tangent to ATC at the firm's output. What does that tangency imply, and does the firm produce at efficient scale?",
        diagramSpec: { type: "monopoly", a: a, b: b, mc0: mc0, atc: pm, showProfit: true, qmax: Math.round((a - mc0) / b) + 2, pmax: a + 2 },
        options: sh.options, answer: sh.correctIndex,
        rationale: "In long-run monopolistic competition, entry drives price down until demand is tangent to ATC \u2014 zero economic profit. But the tangency is on the downward-sloping part of ATC, so the firm produces BELOW efficient scale (excess capacity)."
      };
    }
  };

  /* Ch12: markup over marginal cost (graphical numeric) */
  GEN["ch12_markup"] = {
    id: "ch12_markup", chapter: 12, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "price markup over MC", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]);
      var mc0 = rng_int(rng, 3, 6);
      var qm = rng_int(rng, 3, 6);
      var a = mc0 + 2 * b * qm;
      var pm = a - b * qm;
      var markup = pm - mc0;
      return {
        prompt: "A monopolistically competitive firm has demand P = " + a + " \u2212 " + fmtCoef(b) + "Q and MC = " +
          mc0 + ". It produces where MR = MC. By how much does its PRICE exceed its marginal cost (the markup)?",
        diagramSpec: { type: "monopoly", a: a, b: b, mc0: mc0, qmax: Math.round((a - mc0) / b) + 2, pmax: a + 2 },
        answer: markup, tolerance: 0.01,
        rationale: "Qm = " + qm + ", Pm = " + pm + ". Markup = Pm \u2212 MC = " + pm + " \u2212 " + mc0 + " = " + markup +
          ". Unlike perfect competition, price exceeds marginal cost here."
      };
    }
  };

  /* ============ CHAPTER 15 — Externalities (graphical) ================= */

  /* Ch15: negative externality - socially optimal vs market quantity (numeric) */
  GEN["ch15_neg_externality_q"] = {
    id: "ch15_neg_externality_q", chapter: 15, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "negative externality optimal quantity", points: 3,
    build: function (rng) {
      /* Demand (private value) P=a-b*Q; private supply (MC) P=c+d*Q; external cost e per unit.
         Market q where D=S; social optimum where D = S + e. */
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var c = rng_int(rng, 1, 3);
      var qMkt = rng_int(rng, 6, 9);
      var a = c + (b + d) * qMkt;              /* so market eq at qMkt */
      var e = rng_int(rng, 2, 4);              /* external cost per unit */
      var qOpt = (a - c - e) / (b + d);        /* social optimum */
      return {
        prompt: "A good creates a negative externality (pollution). Private demand is P = " + a + " \u2212 " + fmtCoef(b) +
          "Q, private supply is P = " + c + " + " + fmtCoef(d) + "Q, and each unit imposes an external cost of $" + e +
          " on others. The market produces " + qMkt + " units. What is the socially OPTIMAL quantity? (2 decimals)",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true,
          qmax: qMkt + 3, pmax: a + 2 },
        answer: round2(qOpt), tolerance: 0.1,
        rationale: "The social optimum sets demand = social cost (private MC + external cost): " + a + " \u2212 " + fmtCoef(b) +
          "Q = " + c + " + " + fmtCoef(d) + "Q + " + e + " \u2192 Q = " + round2(qOpt) + " (less than the market's " + qMkt + " \u2014 the market overproduces)."
      };
    }
  };

  /* Ch15: corrective (Pigovian) tax size (numeric) */
  GEN["ch15_pigovian_tax"] = {
    id: "ch15_pigovian_tax", chapter: 15, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "Pigovian tax", points: 3,
    build: function (rng) {
      var e = rng_int(rng, 2, 6);
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var c = rng_int(rng, 1, 3);
      var qMkt = rng_int(rng, 6, 9);
      var a = c + (b + d) * qMkt;
      return {
        prompt: "A factory's production imposes an external cost of $" + e + " per unit on nearby residents. What per-unit corrective (Pigovian) tax would lead the market to produce the socially optimal quantity?",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true, qmax: qMkt + 3, pmax: a + 2 },
        answer: e, tolerance: 0.01,
        rationale: "A Pigovian tax equal to the external cost ($" + e + " per unit) makes producers internalize the externality, shifting the market to the socially optimal quantity."
      };
    }
  };

  /* Ch15: identify over/under-production from externality type (MC) */
  GEN["ch15_externality_type"] = {
    id: "ch15_externality_type", chapter: 15, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "externality over/underproduction", points: 3,
    build: function (rng) {
      var negative = rng() < 0.5;
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var c = rng_int(rng, 1, 3);
      var qMkt = rng_int(rng, 5, 8);
      var a = c + (b + d) * qMkt;
      var opts = negative ?
        ["The market OVERproduces relative to the social optimum; a tax can correct it",
         "The market UNDERproduces; a subsidy can correct it",
         "The market produces the efficient quantity", "Externalities have no effect on efficiency"] :
        ["The market UNDERproduces relative to the social optimum; a subsidy can correct it",
         "The market OVERproduces; a tax can correct it",
         "The market produces the efficient quantity", "Externalities have no effect on efficiency"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "Consider a good that generates a " + (negative ? "NEGATIVE externality (e.g., pollution)" : "POSITIVE externality (e.g., vaccination, education)") +
          ". Compared with the socially optimal quantity, what does the free market do, and how can policy correct it?",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true, qmax: qMkt + 3, pmax: a + 2 },
        options: sh.options, answer: sh.correctIndex,
        rationale: negative ?
          "With a negative externality, social cost exceeds private cost, so the market overproduces. A corrective tax (Pigovian) reduces output to the optimum." :
          "With a positive externality, social benefit exceeds private benefit, so the market underproduces. A subsidy raises output to the optimum."
      };
    }
  };


  /* Ch12: monopolistic competition — is price above MC? (graphical MC) */
  GEN["ch12_price_vs_mc_graph"] = {
    id: "ch12_price_vs_mc_graph", chapter: 12, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "P>MC in mon. comp. (graph)", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]); var mc0 = rng_int(rng, 3, 6); var qm = rng_int(rng, 3, 6);
      var a = mc0 + 2 * b * qm;
      var opts = ["Price exceeds marginal cost, so the outcome is not efficient (some valued units go unsold)",
        "Price equals marginal cost, so the outcome is efficient",
        "Marginal revenue exceeds price", "Price is below marginal cost"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "This monopolistically competitive firm produces where MR = MC. Comparing the price it charges (on the demand curve) with its marginal cost, what can you conclude about efficiency?",
        diagramSpec: { type: "monopoly", a: a, b: b, mc0: mc0, qmax: Math.round((a - mc0) / b) + 2, pmax: a + 2 },
        options: sh.options, answer: sh.correctIndex,
        rationale: "Because demand slopes down, the profit-maximizing price sits above marginal cost. Units that buyers value above MC aren't produced \u2014 an efficiency loss (though offset partly by variety)."
      };
    }
  };

  /* Ch12: identify excess capacity (graphical MC) */
  GEN["ch12_excess_capacity_graph"] = {
    id: "ch12_excess_capacity_graph", chapter: 12, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "excess capacity (graph)", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]); var mc0 = rng_int(rng, 3, 5); var qm = rng_int(rng, 3, 5);
      var a = mc0 + 2 * b * qm; var pm = a - b * qm;
      var opts = ["It produces less than the efficient scale \u2014 it has excess capacity",
        "It produces exactly at minimum ATC", "It produces more than the efficient scale",
        "It produces where price equals marginal cost"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "In long-run equilibrium this monopolistically competitive firm's demand is tangent to ATC on ATC's downward-sloping portion. What does this imply about its scale of production?",
        diagramSpec: { type: "monopoly", a: a, b: b, mc0: mc0, atc: pm, showProfit: true, qmax: Math.round((a - mc0) / b) + 2, pmax: a + 2 },
        options: sh.options, answer: sh.correctIndex,
        rationale: "Tangency on the falling part of ATC means the firm operates below the efficient scale (minimum ATC) \u2014 the hallmark 'excess capacity' of monopolistic competition."
      };
    }
  };

  /* Ch14: labor market equilibrium wage (graphical numeric) */
  GEN["ch14_labor_eq_wage"] = {
    id: "ch14_labor_eq_wage", chapter: 14, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "labor market equilibrium (graph)", points: 3,
    build: function (rng) {
      /* labor demand (VMPL): W = a - b*L ; labor supply: W = c + d*L */
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var Lstar = rng_int(rng, 3, 7), c = rng_int(rng, 2, 5);
      var wStar = c + d * Lstar, a = wStar + b * Lstar;
      return {
        prompt: "In a competitive labor market, labor demand (the value of marginal product) is W = " + a + " \u2212 " +
          fmtCoef(b) + "L and labor supply is W = " + c + " + " + fmtCoef(d) + "L. Find the equilibrium WAGE.",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true,
          xlab: "Labor (L)", ylab: "Wage (W)", qmax: Lstar + 3, pmax: a + 2 },
        answer: wStar, tolerance: 0.01,
        rationale: "Set labor demand = labor supply: " + a + " \u2212 " + fmtCoef(b) + "L = " + c + " + " + fmtCoef(d) +
          "L \u2192 L = " + Lstar + ", so W = " + wStar + "."
      };
    }
  };

  /* Ch14: effect of a labor-supply increase (graphical MC) */
  GEN["ch14_labor_supply_shift"] = {
    id: "ch14_labor_supply_shift", chapter: 14, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "labor supply shift (graph)", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var Lstar = rng_int(rng, 4, 6), c = rng_int(rng, 2, 4);
      var wStar = c + d * Lstar, a = wStar + b * Lstar;
      var opts = ["The wage falls and the quantity of labor employed rises",
        "The wage rises and employment falls", "Both wage and employment rise",
        "Both wage and employment fall"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "The graph shows a competitive labor market (demand = VMPL). If immigration increases the labor SUPPLY (shifts it right), holding labor demand fixed, what happens to the equilibrium wage and employment?",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true,
          xlab: "Labor (L)", ylab: "Wage (W)", qmax: Lstar + 4, pmax: a + 2 },
        options: sh.options, answer: sh.correctIndex,
        rationale: "A rightward labor-supply shift moves down along labor demand: the wage falls while the quantity of labor employed rises."
      };
    }
  };

  /* Ch14: effect of higher output price on labor demand (graphical MC) */
  GEN["ch14_labor_demand_shift_graph"] = {
    id: "ch14_labor_demand_shift_graph", chapter: 14, kind: "mc", render: "graphical",
    difficulty: "hard", concept: "labor demand shift (graph)", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var Lstar = rng_int(rng, 4, 6), c = rng_int(rng, 2, 4);
      var wStar = c + d * Lstar, a = wStar + b * Lstar;
      var opts = ["Both the equilibrium wage and employment rise",
        "The wage falls and employment falls", "The wage rises but employment falls",
        "Nothing changes"];
      var sh = shuffleWithAnswer(rng, opts, 0);
      return {
        prompt: "The price of the output these workers produce rises, increasing the value of their marginal product (labor DEMAND shifts right), with labor supply fixed. What happens to the equilibrium wage and employment?",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true,
          xlab: "Labor (L)", ylab: "Wage (W)", qmax: Lstar + 4, pmax: a + 3 },
        options: sh.options, answer: sh.correctIndex,
        rationale: "A rightward labor-demand shift (higher VMPL) raises both the equilibrium wage and the quantity of labor employed."
      };
    }
  };

  /* Ch14: VMPL read/computation (graphical numeric) */
  GEN["ch14_vmpl_graph"] = {
    id: "ch14_vmpl_graph", chapter: 14, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "VMPL and hiring (graph)", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var Lstar = rng_int(rng, 3, 6), c = rng_int(rng, 2, 5);
      var wStar = c + d * Lstar, a = wStar + b * Lstar;
      return {
        prompt: "Labor demand (VMPL) is W = " + a + " \u2212 " + fmtCoef(b) + "L and labor supply is W = " + c + " + " +
          fmtCoef(d) + "L. How many workers (L) will this competitive firm/market employ in equilibrium?",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true,
          xlab: "Labor (L)", ylab: "Wage (W)", qmax: Lstar + 3, pmax: a + 2 },
        answer: Lstar, tolerance: 0.01,
        rationale: "Employment is where labor demand meets supply: " + a + " \u2212 " + fmtCoef(b) + "L = " + c + " + " +
          fmtCoef(d) + "L \u2192 L = " + Lstar + " (each worker hired until VMPL = wage)."
      };
    }
  };

  /* Ch15: two more graphical — total external cost, and welfare gain from tax */
  GEN["ch15_external_cost_total"] = {
    id: "ch15_external_cost_total", chapter: 15, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "total external cost (graph)", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var c = rng_int(rng, 1, 3);
      var qMkt = rng_int(rng, 5, 9);
      var a = c + (b + d) * qMkt;
      var e = rng_int(rng, 2, 4);
      var totalExt = e * qMkt;
      return {
        prompt: "A market produces " + qMkt + " units, and each unit imposes an external cost of $" + e +
          " on bystanders. What is the TOTAL external cost imposed at the market quantity?",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true, qmax: qMkt + 3, pmax: a + 2 },
        answer: totalExt, tolerance: 0.01,
        rationale: "Total external cost = external cost per unit \u00d7 quantity = $" + e + " \u00d7 " + qMkt + " = $" + totalExt + "."
      };
    }
  };

  /* Ch15: deadweight loss from a negative externality (graphical numeric) */
  GEN["ch15_externality_dwl"] = {
    id: "ch15_externality_dwl", chapter: 15, kind: "numeric", render: "graphical",
    difficulty: "hard", concept: "externality deadweight loss (graph)", points: 3,
    build: function (rng) {
      var b = rng_pick(rng, [1, 2]), d = rng_pick(rng, [1, 2]);
      var c = rng_int(rng, 1, 3);
      var qMkt = rng_int(rng, 6, 9);
      var a = c + (b + d) * qMkt;
      var e = rng_int(rng, 2, 4);
      var qOpt = (a - c - e) / (b + d);
      /* DWL triangle: half * e * (qMkt - qOpt) */
      var dwl = 0.5 * e * (qMkt - qOpt);
      return {
        prompt: "With private demand P = " + a + " \u2212 " + fmtCoef(b) + "Q, private supply P = " + c + " + " +
          fmtCoef(d) + "Q, and an external cost of $" + e + " per unit, the market makes " + qMkt +
          " units but the optimum is " + round2(qOpt) + ". Compute the deadweight loss from overproduction. (2 decimals)",
        diagramSpec: { type: "supply_demand", dA: a, dB: -b, sA: c, sB: d, showEq: true, qmax: qMkt + 3, pmax: a + 2 },
        answer: round2(dwl), tolerance: 0.2,
        rationale: "DWL = \u00bd \u00d7 (external cost) \u00d7 (Q_market \u2212 Q_optimal) = \u00bd \u00d7 " + e + " \u00d7 (" + qMkt + " \u2212 " +
          round2(qOpt) + ") = " + round2(dwl) + "."
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
    {
      id: "ch1_scarcity", chapter: 1, kind: "mc", render: "text", difficulty: "easy", concept: "scarcity", points: 1,
      prompt: "In economics, \u201cscarcity\u201d means that:",
      options: ["society's wants exceed the resources available to satisfy them",
        "a good is rare and expensive", "the government has restricted supply", "a product has sold out"],
      answer: 0,
      rationale: "Scarcity is the fundamental condition that resources are limited relative to unlimited wants \u2014 which is why choices must be made."
    },
    {
      id: "ch1_efficiency_equity", chapter: 1, kind: "mc", render: "text", difficulty: "med", concept: "efficiency vs equity", points: 1,
      prompt: "A policy that redistributes income from rich to poor may reduce the total size of the economic \u201cpie.\u201d This illustrates the tradeoff between:",
      options: ["efficiency and equity", "inflation and unemployment", "guns and butter", "saving and investment"],
      answer: 0,
      rationale: "Efficiency = the size of the pie; equity = how fairly it's divided. Policies often trade one for the other."
    },
    {
      id: "ch1_rational_margin", chapter: 1, kind: "mc", render: "text", difficulty: "med", concept: "marginal thinking", points: 1,
      prompt: "\u201cRational people think at the margin\u201d means they:",
      options: ["compare the additional benefit and additional cost of a small change",
        "always choose the cheapest option", "ignore sunk costs entirely by habit", "maximize total benefit regardless of cost"],
      answer: 0,
      rationale: "Marginal decision-making weighs the extra (marginal) benefit against the extra (marginal) cost of one more unit of something."
    },
    {
      id: "ch1_sunk_cost", chapter: 1, kind: "mc", render: "text", difficulty: "hard", concept: "sunk cost", points: 1,
      prompt: "You've paid $12 for a movie ticket (non-refundable). Ten minutes in, you realize you dislike the film. A rational, marginal decision-maker asks:",
      options: ["Is the rest of the movie worth more to me than what else I could do with that time?",
        "How can I get my $12 back?", "Since I paid, I should stay to not waste money", "What was the average cost per minute?"],
      answer: 0,
      rationale: "The $12 is a sunk cost \u2014 unrecoverable and irrelevant. Only the forward-looking marginal comparison matters."
    },
    {
      id: "ch1_invisible_hand", chapter: 1, kind: "mc", render: "text", difficulty: "med", concept: "markets and the invisible hand", points: 1,
      prompt: "Adam Smith's \u201cinvisible hand\u201d refers to the idea that:",
      options: ["self-interested individuals in a market are led to promote society's overall well-being through prices",
        "the government secretly guides the economy", "monopolies naturally arise in all markets", "trade always harms one side"],
      answer: 0,
      rationale: "Prices act as signals that coordinate the decisions of buyers and sellers, often leading to desirable social outcomes without central direction."
    },
    {
      id: "ch1_market_failure", chapter: 1, kind: "mc", render: "text", difficulty: "hard", concept: "market failure and government", points: 1,
      prompt: "Which situation is the strongest justification for government intervention in a market on efficiency grounds?",
      options: ["A factory pollutes a river used by others (an externality)",
        "A company earns high profits", "Consumers prefer one brand over another", "Prices rise during a shortage"],
      answer: 0,
      rationale: "Externalities like pollution are a form of market failure \u2014 a case where markets alone don't allocate resources efficiently, justifying possible intervention."
    },
    {
      id: "ch1_productivity", chapter: 1, kind: "mc", render: "text", difficulty: "med", concept: "productivity and living standards", points: 1,
      prompt: "Economists attribute large differences in living standards across countries primarily to differences in:",
      options: ["productivity (output produced per hour of work)", "the amount of money printed",
        "natural resource endowments alone", "the size of the population"],
      answer: 0,
      rationale: "A country's standard of living depends chiefly on its productivity \u2014 how many goods and services workers can produce per unit of time."
    },
    {
      id: "ch1_inflation_money", chapter: 1, kind: "mc", render: "text", difficulty: "med", concept: "money growth and inflation", points: 1,
      prompt: "According to one of the ten principles, the primary long-run cause of high and persistent inflation is:",
      options: ["excessive growth in the quantity of money", "greedy businesses raising prices",
        "labor unions demanding higher wages", "rising oil prices"],
      answer: 0,
      rationale: "When a government creates large quantities of money, the value of the money falls \u2014 the classic long-run source of inflation."
    },
    {
      id: "ch1_phillips_tradeoff", chapter: 1, kind: "mc", render: "text", difficulty: "hard", concept: "short-run inflation-unemployment tradeoff", points: 1,
      prompt: "In the short run, an economy faces a tradeoff between:",
      options: ["inflation and unemployment", "saving and consumption",
        "exports and imports", "taxes and spending"],
      answer: 0,
      rationale: "In the short run, policies that reduce inflation often raise unemployment and vice versa \u2014 the short-run Phillips-curve tradeoff."
    },
    {
      id: "ch1_gains_trade_principle", chapter: 1, kind: "mc", render: "text", difficulty: "easy", concept: "trade can benefit everyone", points: 1,
      prompt: "\u201cTrade can make everyone better off\u201d because trade:",
      options: ["allows people to specialize in what they do best and buy other goods more cheaply",
        "guarantees equal outcomes for all", "eliminates all competition", "removes the need for money"],
      answer: 0,
      rationale: "Trade lets each party specialize according to comparative advantage and obtain a greater variety of goods at lower cost."
    },
    {
      id: "ch1_opp_cost_college", chapter: 1, kind: "numeric", render: "text", difficulty: "med", concept: "opportunity cost", points: 2,
      build: undefined,   /* static numeric */
      prompt: "A student pays $9,000 in tuition and $2,000 for books to attend college for a year. By attending, she gives up a job that would have paid $21,000. What is the total (economic) opportunity cost of the year of college?",
      answer: 32000, tolerance: 0.01,
      rationale: "Economic opportunity cost = explicit costs ($9,000 + $2,000) + forgone earnings ($21,000) = $32,000. (Room and board are excluded since she'd pay for those anyway.)"
    },
    {
      id: "ch1_incentive_unintended", chapter: 1, kind: "mc", render: "text", difficulty: "hard", concept: "incentives and unintended effects", points: 2,
      prompt: "A law requires seatbelts, making drivers feel safer. Some economists predicted this could lead to:",
      options: ["more aggressive driving, partially offsetting the safety gain (an incentive effect)",
        "fewer cars on the road", "an immediate drop in car prices", "higher fuel efficiency"],
      answer: 0,
      rationale: "Because people respond to incentives, feeling safer can encourage riskier driving \u2014 an unintended behavioral response to the policy."
    },
    {
      id: "ch1_role_of_prices", chapter: 1, kind: "mc", render: "text", difficulty: "med", concept: "markets organize activity", points: 1,
      prompt: "In a market economy, the decisions of what and how much to produce are guided mainly by:",
      options: ["prices, which respond to the choices of millions of buyers and sellers",
        "a central planning committee", "the largest firm in each industry", "international treaties"],
      answer: 0,
      rationale: "Market economies rely on decentralized price signals rather than central planning to allocate resources."
    },
    {
      id: "ch1_written_incentive_policy", chapter: 1, kind: "short", render: "text", difficulty: "hard", concept: "incentives", points: 3,
      prompt: "A city wants to reduce littering. Using the principle that \u201cpeople respond to incentives,\u201d propose one policy and explain the incentive it creates \u2014 and one possible unintended consequence.",
      answer: null,
      rubric: "Full credit: (1) a concrete policy (deposit on bottles, fine for littering, etc.); (2) explains the incentive it creates (makes littering costly / returns valuable); (3) identifies a plausible unintended consequence (e.g., people dump elsewhere, or theft of recyclables). Partial credit per element.",
      rationale: "Looking for a policy, its incentive mechanism, and a thoughtful unintended effect."
    },
    {
      id: "ch1_written_efficiency_equity", chapter: 1, kind: "short", render: "text", difficulty: "hard", concept: "efficiency vs equity", points: 3,
      prompt: "Define efficiency and equity in your own words, and explain why policies designed to increase equity can sometimes reduce efficiency. Give an example.",
      answer: null,
      rubric: "Full credit: (1) efficiency = getting the most from scarce resources (size of the pie); (2) equity = fair distribution (how the pie is divided); (3) explains the tension (e.g., high redistributive taxes can blunt incentives to work/invest); (4) a valid example. Partial credit per element.",
      rationale: "Looking for both definitions plus the incentive-based reason for the tradeoff and an example."
    },
    {
      id: "ch1_specialization", chapter: 1, kind: "mc", render: "text", difficulty: "easy", concept: "gains from trade", points: 1,
      prompt: "Why don't most families try to be self-sufficient, growing all their own food and making their own clothes?",
      options: ["Specializing and trading with others lets them enjoy more goods at lower cost",
        "Laws prohibit self-sufficiency", "It is impossible to grow food", "Trade is required by the government"],
      answer: 0,
      rationale: "Specialization according to comparative advantage plus trade yields more total output than everyone doing everything themselves."
    },
    {
      id: "ch1_central_planning", chapter: 1, kind: "mc", render: "text", difficulty: "med", concept: "markets vs central planning", points: 1,
      prompt: "A key reason centrally planned economies historically struggled is that planners:",
      options: ["lacked the price signals that coordinate millions of decentralized decisions",
        "had too much information", "faced no scarcity", "allowed too much competition"],
      answer: 0,
      rationale: "Without market prices to convey information about relative scarcity and value, central planners cannot efficiently coordinate production and consumption."
    },
    {
      id: "ch1_govt_property_rights", chapter: 1, kind: "mc", render: "text", difficulty: "med", concept: "government and property rights", points: 1,
      prompt: "One essential role government plays in supporting markets is to:",
      options: ["enforce property rights so people can own and trade what they produce",
        "set the price of every good", "employ most of the workforce", "produce all goods directly"],
      answer: 0,
      rationale: "Markets depend on institutions \u2014 especially enforceable property rights and contracts \u2014 that government provides."
    },
    {
      id: "ch1_marginal_benefit_water", chapter: 1, kind: "mc", render: "text", difficulty: "hard", concept: "marginal thinking (diamond-water)", points: 2,
      prompt: "Water is essential to life yet cheap, while diamonds are inessential yet expensive. The best explanation is that price reflects:",
      options: ["marginal benefit \u2014 and water is so abundant that its marginal unit is worth little",
        "total usefulness to society", "the labor used to obtain each good only", "government price setting"],
      answer: 0,
      rationale: "Price reflects marginal (not total) value. Because water is plentiful, the marginal unit is worth little; scarce diamonds have high marginal value."
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
    ,
    /* ==================== Chapter 2 additions ==================== */
    { id: "ch2_circular_flow", chapter: 2, kind: "mc", render: "text", difficulty: "med", concept: "circular-flow diagram", points: 1,
      prompt: "In the circular-flow diagram, households supply which of the following in the markets for factors of production?",
      options: ["labor, land, and capital", "finished goods and services", "tax revenue", "government subsidies"], answer: 0,
      rationale: "In factor markets, households are the sellers of inputs (labor, land, capital); firms are the buyers." },
    { id: "ch2_model_assumptions", chapter: 2, kind: "mc", render: "text", difficulty: "med", concept: "role of assumptions", points: 1,
      prompt: "Economists make simplifying assumptions in their models primarily to:",
      options: ["focus attention on the forces that matter most for the question at hand", "make the math impossible", "guarantee the model is always right", "avoid using data"], answer: 0,
      rationale: "Assumptions strip away detail so the key relationships stand out \u2014 like a map that omits some features to be useful." },
    { id: "ch2_economist_scientist", chapter: 2, kind: "mc", render: "text", difficulty: "easy", concept: "economist as scientist", points: 1,
      prompt: "When an economist acts as a scientist, she is mainly trying to:",
      options: ["explain how the world works", "say how the world ought to be", "win a political argument", "set prices"], answer: 0,
      rationale: "As scientists economists make positive statements (explaining the world); as policy advisers they make normative statements." },
    { id: "ch2_ppf_efficiency", chapter: 2, kind: "mc", render: "text", difficulty: "med", concept: "PPF efficiency", points: 1,
      prompt: "A point ON the production possibilities frontier is:",
      options: ["efficient \u2014 producing more of one good requires making less of another", "always the best point for society", "unattainable", "inefficient"], answer: 0,
      rationale: "Points on the frontier use all resources efficiently; moving along it involves a tradeoff." },
    { id: "ch2_ppf_growth", chapter: 2, kind: "mc", render: "text", difficulty: "med", concept: "PPF and growth", points: 1,
      prompt: "An improvement in technology that raises production of both goods is best shown as:",
      options: ["an outward shift of the entire PPF", "a movement along the PPF", "a point inside the PPF", "a steeper PPF only"], answer: 0,
      rationale: "Economic growth expands the economy's capacity, shifting the whole frontier outward." },
    { id: "ch2_ppf_opportunity_bowed", chapter: 2, kind: "mc", render: "text", difficulty: "hard", concept: "bowed PPF", points: 2,
      prompt: "A production possibilities frontier is typically bowed outward (concave) because:",
      options: ["resources are not equally suited to producing both goods, so opportunity cost rises as you specialize", "of inflation", "resources are unlimited", "the two goods are identical"], answer: 0,
      rationale: "As you shift resources toward one good, you must use inputs increasingly ill-suited to it, raising opportunity cost \u2014 the bowed shape." },
    { id: "ch2_micro_macro_2", chapter: 2, kind: "mc", render: "text", difficulty: "easy", concept: "micro vs macro", points: 1,
      prompt: "Which is a MACROeconomic topic?",
      options: ["the effect of a government budget deficit on national saving", "how a frost affects the price of oranges", "a family's decision to buy a car", "a firm's hiring of one more worker"], answer: 0,
      rationale: "Macroeconomics studies economy-wide phenomena (deficits, national saving); the others are microeconomic." },
    { id: "ch2_positive_normative_2", chapter: 2, kind: "mc", render: "text", difficulty: "med", concept: "positive vs normative", points: 1,
      prompt: "\u201cAn increase in the minimum wage will raise teenage unemployment\u201d is:",
      options: ["a positive statement", "a normative statement", "an opinion that can't be tested", "a value judgment"], answer: 0,
      rationale: "It's a testable claim about cause and effect \u2014 positive, whether or not it turns out to be true." },
    { id: "ch2_economists_disagree", chapter: 2, kind: "mc", render: "text", difficulty: "med", concept: "why economists disagree", points: 1,
      prompt: "Two economists may give conflicting policy advice mainly because they:",
      options: ["hold different values or different scientific judgments about how the economy works", "never studied economics", "are always irrational", "cannot use data"], answer: 0,
      rationale: "Disagreements stem from differing normative values and/or differing positive theories \u2014 not from ignorance." },
    { id: "ch2_ceteris_paribus_model", chapter: 2, kind: "mc", render: "text", difficulty: "med", concept: "ceteris paribus", points: 1,
      prompt: "The Latin phrase \u201cceteris paribus\u201d is used in economic models to mean:",
      options: ["all other variables are held constant", "everything changes at once", "the model is normative", "prices are fixed by law"], answer: 0,
      rationale: "Holding other things equal lets economists isolate the effect of one variable at a time." },
    { id: "ch2_theory_data", chapter: 2, kind: "mc", render: "text", difficulty: "easy", concept: "scientific method in economics", points: 1,
      prompt: "Unlike many natural scientists, economists usually cannot:",
      options: ["run controlled laboratory experiments on the whole economy", "use data at all", "form hypotheses", "build models"], answer: 0,
      rationale: "Economists mostly rely on natural experiments and historical data because controlled economy-wide experiments are rarely possible." },
    { id: "ch2_ppf_unattainable", chapter: 2, kind: "mc", render: "text", difficulty: "easy", concept: "PPF unattainable points", points: 1,
      prompt: "A point outside (beyond) the production possibilities frontier is:",
      options: ["unattainable with current resources and technology", "efficient", "inefficient", "always preferred and reachable"], answer: 0,
      rationale: "Points beyond the frontier require more resources or better technology than currently available." },
    { id: "ch2_ppf_tradeoff_written", chapter: 2, kind: "short", render: "text", difficulty: "hard", concept: "PPF tradeoffs", points: 3,
      prompt: "Using a production possibilities frontier for \u201cguns\u201d and \u201cbutter,\u201d explain (a) what a point inside the curve means, (b) what moving along the curve costs, and (c) what would shift the curve outward.",
      answer: null,
      rubric: "Full credit: (a) inside = inefficient/idle resources; (b) moving along = opportunity cost, more guns means less butter; (c) outward shift from more resources or better technology. Partial credit per part.",
      rationale: "Looking for inefficiency inside, opportunity cost along, and growth shifting the curve." },
    { id: "ch2_written_positive_normative", chapter: 2, kind: "short", render: "text", difficulty: "med", concept: "positive vs normative", points: 3,
      prompt: "Explain the difference between positive and normative statements, and give one example of each about the topic of taxes.",
      answer: null,
      rubric: "Full credit: (1) positive = descriptive/testable claim about what is; (2) normative = value judgment about what ought to be; (3) a valid positive tax example (e.g., 'a higher tax reduces cigarette sales'); (4) a valid normative tax example (e.g., 'taxes on the rich should be higher'). Partial credit per element.",
      rationale: "Looking for both definitions and one correct example of each." },
    { id: "ch2_model_map", chapter: 2, kind: "mc", render: "text", difficulty: "easy", concept: "models as simplifications", points: 1,
      prompt: "An economic model is most like:",
      options: ["a map \u2014 a simplified representation that omits detail to be useful", "a photograph capturing every detail", "a crystal ball", "a legal contract"], answer: 0,
      rationale: "Like a map, a good model leaves out inessential detail to illuminate what matters." },
    { id: "ch2_factor_market", chapter: 2, kind: "mc", render: "text", difficulty: "med", concept: "circular flow \u2014 firms", points: 1,
      prompt: "In the circular-flow diagram, in the markets for goods and services, firms are the ____ and households are the ____.",
      options: ["sellers; buyers", "buyers; sellers", "buyers; buyers", "sellers; sellers"], answer: 0,
      rationale: "In product markets firms sell output and households buy it; the roles reverse in factor markets." }
    ,
    /* ==================== Chapter 3 additions ==================== */
    { id: "ch3_absolute_advantage_def", chapter: 3, kind: "mc", render: "text", difficulty: "easy", concept: "absolute advantage", points: 1,
      prompt: "A producer has an ABSOLUTE advantage in a good if she can:",
      options: ["produce it using fewer inputs than another producer", "produce it at a lower opportunity cost", "sell it at a higher price", "produce more goods in total"], answer: 0,
      rationale: "Absolute advantage is about using fewer resources (higher productivity); comparative advantage is about lower opportunity cost." },
    { id: "ch3_comparative_def", chapter: 3, kind: "mc", render: "text", difficulty: "easy", concept: "comparative advantage", points: 1,
      prompt: "A producer has a COMPARATIVE advantage in a good if she:",
      options: ["has a lower opportunity cost of producing it", "can produce more of it", "has more workers", "charges less for it"], answer: 0,
      rationale: "Comparative advantage is defined by the lowest opportunity cost, which is what drives beneficial specialization." },
    { id: "ch3_terms_of_trade", chapter: 3, kind: "mc", render: "text", difficulty: "hard", concept: "terms of trade", points: 2,
      prompt: "For both parties to gain from trading two goods, the agreed trading price (terms of trade) must lie:",
      options: ["between the two producers' opportunity costs", "below both opportunity costs", "above both opportunity costs", "exactly at zero"], answer: 0,
      rationale: "A price between the two opportunity costs lets each side get the good it imports for less than it would cost to make at home." },
    { id: "ch3_specialization_gain", chapter: 3, kind: "mc", render: "text", difficulty: "med", concept: "gains from specialization", points: 1,
      prompt: "When two people specialize according to comparative advantage and trade, total output:",
      options: ["increases compared with self-sufficiency", "stays the same", "always decreases", "becomes zero"], answer: 0,
      rationale: "Specialization directs each producer to what they do at lowest opportunity cost, raising combined output." },
    { id: "ch3_who_produces_what", chapter: 3, kind: "mc", render: "text", difficulty: "med", concept: "applying comparative advantage", points: 1,
      prompt: "A lawyer can type faster than her assistant but earns far more practicing law. She should:",
      options: ["specialize in law and let the assistant type \u2014 comparative advantage", "do her own typing since she's faster", "stop practicing law", "type and delegate the law"], answer: 0,
      rationale: "Even with an absolute advantage in typing, the lawyer's opportunity cost of typing is high, so she should specialize in law." },
    { id: "ch3_import_export", chapter: 3, kind: "mc", render: "text", difficulty: "med", concept: "trade patterns", points: 1,
      prompt: "A country will tend to EXPORT the good in which it has:",
      options: ["a comparative advantage", "an absolute disadvantage", "the highest opportunity cost", "no production"], answer: 0,
      rationale: "Countries export goods they produce at relatively low opportunity cost (comparative advantage) and import the others." },
    { id: "ch3_self_sufficiency", chapter: 3, kind: "mc", render: "text", difficulty: "easy", concept: "gains from trade", points: 1,
      prompt: "Compared with self-sufficiency, specialization and trade allow a country to consume:",
      options: ["at a point beyond its own production possibilities frontier", "only on its PPF", "only inside its PPF", "nothing new"], answer: 0,
      rationale: "Trade lets a country consume combinations its own resources could not produce \u2014 outside its PPF." },
    { id: "ch3_opp_cost_reciprocal", chapter: 3, kind: "mc", render: "text", difficulty: "hard", concept: "opportunity cost reciprocal", points: 2,
      prompt: "If one worker's opportunity cost of 1 unit of good X is 2 units of good Y, then her opportunity cost of 1 unit of good Y is:",
      options: ["1/2 unit of X", "2 units of X", "4 units of X", "1 unit of X"], answer: 0,
      rationale: "Opportunity costs are reciprocals: if 1 X costs 2 Y, then 1 Y costs 1/2 X." },
    { id: "ch3_both_gain", chapter: 3, kind: "mc", render: "text", difficulty: "med", concept: "mutual gains", points: 1,
      prompt: "In a voluntary trade based on comparative advantage:",
      options: ["both parties can be made better off", "one party must lose for the other to gain", "only the richer party gains", "neither party gains"], answer: 0,
      rationale: "Voluntary trade based on comparative advantage is positive-sum: both sides can gain." },
    { id: "ch3_absolute_both", chapter: 3, kind: "mc", render: "text", difficulty: "hard", concept: "absolute advantage in both", points: 2,
      prompt: "If one country has an absolute advantage in BOTH goods, gains from trade:",
      options: ["are still possible if the countries' opportunity costs differ", "are impossible", "flow only to the poorer country", "require identical opportunity costs"], answer: 0,
      rationale: "What matters is comparative advantage; as long as opportunity costs differ, specialization and trade still help both." },
    { id: "ch3_ca_numeric_hours", chapter: 3, kind: "numeric", render: "text", difficulty: "med", concept: "opportunity cost from hours", points: 2,
      prompt: "It takes Ana 2 hours to make a chair and 1 hour to make a stool. In terms of stools, what is Ana's opportunity cost of making one chair?",
      answer: 2, tolerance: 0.01,
      rationale: "A chair takes 2 hours; a stool takes 1 hour. So one chair costs the 2 stools she could have made instead." },
    { id: "ch3_ppf_trade_written", chapter: 3, kind: "short", render: "text", difficulty: "hard", concept: "gains from trade", points: 3,
      prompt: "Two neighboring farms each grow apples and wheat. Explain how they could each end up with more of BOTH goods by specializing and trading, even though no new land or labor is added.",
      answer: null,
      rubric: "Full credit: (1) each farm has a comparative advantage (lower opportunity cost) in one good; (2) specializing raises total output of both goods; (3) trading at terms between the opportunity costs lets each get more of both; (4) no new resources needed \u2014 the gain comes from better allocation. Partial credit per element.",
      rationale: "Looking for comparative advantage, higher total output from specialization, and beneficial terms of trade." },
    { id: "ch3_written_absolute_vs_comp", chapter: 3, kind: "short", render: "text", difficulty: "med", concept: "absolute vs comparative", points: 3,
      prompt: "Explain the difference between absolute advantage and comparative advantage, and state which one determines the pattern of specialization and trade. Why?",
      answer: null,
      rubric: "Full credit: (1) absolute advantage = fewer inputs / higher productivity; (2) comparative advantage = lower opportunity cost; (3) comparative advantage determines specialization; (4) because a producer gains by specializing where its opportunity cost is lowest, regardless of absolute productivity. Partial credit per element.",
      rationale: "Looking for both definitions and that comparative advantage drives trade." },
    { id: "ch3_trade_not_zero_sum", chapter: 3, kind: "mc", render: "text", difficulty: "med", concept: "trade is not zero-sum", points: 1,
      prompt: "\u201cIn trade between two countries, one country's gain must be the other's loss.\u201d This statement is:",
      options: ["false \u2014 voluntary trade can benefit both", "true for all trade", "true only for rich countries", "true only for goods"], answer: 0,
      rationale: "Trade based on comparative advantage is positive-sum; the zero-sum view is a common misconception." },
    { id: "ch3_ca_table_reading", chapter: 3, kind: "numeric", render: "text", difficulty: "hard", concept: "opportunity cost from output", points: 2,
      prompt: "In a day, a worker can produce 12 pens OR 4 notebooks. What is the opportunity cost, in pens, of producing one notebook?",
      answer: 3, tolerance: 0.01,
      rationale: "12 pens / 4 notebooks = 3 pens forgone per notebook." },
    { id: "ch3_interdependence", chapter: 3, kind: "mc", render: "text", difficulty: "easy", concept: "economic interdependence", points: 1,
      prompt: "Modern economies feature extensive interdependence primarily because:",
      options: ["specialization based on comparative advantage makes people rely on trade for most goods", "governments require it", "money is scarce", "people dislike self-sufficiency"], answer: 0,
      rationale: "Specialization means each of us produces few things and trades for the rest \u2014 the source of interdependence." }
    ,
    /* ==================== Chapter 5 additions ==================== */
    { id: "ch5_elasticity_def", chapter: 5, kind: "mc", render: "text", difficulty: "easy", concept: "elasticity definition", points: 1,
      prompt: "Price elasticity of demand measures:",
      options: ["how much quantity demanded responds to a change in price", "how much price responds to demand", "the slope of the supply curve", "total revenue"], answer: 0,
      rationale: "Elasticity = percentage change in quantity demanded divided by percentage change in price." },
    { id: "ch5_perfectly_inelastic", chapter: 5, kind: "mc", render: "text", difficulty: "med", concept: "perfectly inelastic demand", points: 1,
      prompt: "A demand curve that is a vertical line represents demand that is:",
      options: ["perfectly inelastic (elasticity = 0)", "perfectly elastic", "unit elastic", "elastic"], answer: 0,
      rationale: "A vertical demand curve means quantity doesn't respond to price at all \u2014 perfectly inelastic." },
    { id: "ch5_perfectly_elastic", chapter: 5, kind: "mc", render: "text", difficulty: "med", concept: "perfectly elastic demand", points: 1,
      prompt: "A horizontal demand curve represents demand that is:",
      options: ["perfectly elastic (elasticity = infinity)", "perfectly inelastic", "unit elastic", "inelastic"], answer: 0,
      rationale: "A horizontal demand curve means buyers will purchase any quantity at one price but none above it \u2014 perfectly elastic." },
    { id: "ch5_determinant_necessity", chapter: 5, kind: "mc", render: "text", difficulty: "med", concept: "determinants of elasticity", points: 1,
      prompt: "Demand for a good tends to be MORE inelastic when the good is:",
      options: ["a necessity with few substitutes", "a luxury with many substitutes", "narrowly defined", "considered over a long time horizon"], answer: 0,
      rationale: "Necessities with few substitutes have inelastic demand; luxuries, narrowly-defined goods, and long horizons make demand more elastic." },
    { id: "ch5_time_horizon", chapter: 5, kind: "mc", render: "text", difficulty: "hard", concept: "elasticity and time", points: 2,
      prompt: "Demand for gasoline is generally more elastic in the long run than the short run because:",
      options: ["over time people can buy more fuel-efficient cars or move closer to work", "gasoline has no substitutes ever", "prices never change", "the government fixes long-run prices"], answer: 0,
      rationale: "Given more time, consumers adjust more fully (different cars, habits, locations), so demand is more elastic in the long run." },
    { id: "ch5_cross_price_substitutes", chapter: 5, kind: "mc", render: "text", difficulty: "hard", concept: "cross-price elasticity", points: 2,
      prompt: "If a rise in the price of tea increases the quantity of coffee demanded, the cross-price elasticity between them is:",
      options: ["positive \u2014 they are substitutes", "negative \u2014 they are complements", "zero \u2014 unrelated", "undefined"], answer: 0,
      rationale: "Substitutes have positive cross-price elasticity: a higher price for one raises demand for the other." },
    { id: "ch5_cross_price_complements", chapter: 5, kind: "mc", render: "text", difficulty: "hard", concept: "cross-price elasticity", points: 2,
      prompt: "If a rise in the price of printers reduces the quantity of ink demanded, the two goods are:",
      options: ["complements (negative cross-price elasticity)", "substitutes (positive cross-price elasticity)", "unrelated", "both inferior"], answer: 0,
      rationale: "Complements have negative cross-price elasticity: a higher price for one lowers demand for the other." },
    { id: "ch5_supply_elasticity", chapter: 5, kind: "mc", render: "text", difficulty: "med", concept: "price elasticity of supply", points: 1,
      prompt: "Price elasticity of supply is likely to be HIGHER (more elastic) when:",
      options: ["firms can easily increase production, e.g., with spare capacity or over a long period", "production capacity is fixed", "the good is perishable and must sell now", "the time horizon is very short"], answer: 0,
      rationale: "Supply is more elastic when producers can readily adjust output \u2014 spare capacity or a longer time horizon." },
    { id: "ch5_total_revenue_inelastic", chapter: 5, kind: "mc", render: "text", difficulty: "hard", concept: "total revenue test", points: 2,
      prompt: "For a good with inelastic demand, a firm that wants to raise total revenue should:",
      options: ["raise the price", "lower the price", "leave price unchanged", "shut down"], answer: 0,
      rationale: "With inelastic demand, quantity falls proportionally less than price rises, so raising price raises revenue." },
    { id: "ch5_unit_elastic", chapter: 5, kind: "mc", render: "text", difficulty: "med", concept: "unit elastic", points: 1,
      prompt: "When demand is unit elastic (|E| = 1), a change in price leaves total revenue:",
      options: ["unchanged", "higher", "lower", "at zero"], answer: 0,
      rationale: "At unit elasticity, the percentage change in quantity exactly offsets the percentage change in price, so revenue is unchanged." },
    { id: "ch5_midpoint_why", chapter: 5, kind: "mc", render: "text", difficulty: "med", concept: "midpoint method", points: 1,
      prompt: "Economists use the midpoint (average) method to compute elasticity because it:",
      options: ["gives the same elasticity whether price rises or falls between two points", "is easier than any other method", "always gives elasticity greater than 1", "ignores quantity"], answer: 0,
      rationale: "Using averages in the denominators makes the elasticity between two points identical in both directions." },
    { id: "ch5_slope_vs_elasticity", chapter: 5, kind: "mc", render: "text", difficulty: "hard", concept: "slope vs elasticity", points: 2,
      prompt: "Along a straight-line (linear) downward-sloping demand curve, elasticity:",
      options: ["is larger (more elastic) at higher prices and smaller at lower prices", "is constant everywhere", "equals the slope", "is always 1"], answer: 0,
      rationale: "Even with constant slope, elasticity varies along a linear demand curve \u2014 elastic at the top, inelastic at the bottom." },
    { id: "ch5_income_elastic_luxury", chapter: 5, kind: "mc", render: "text", difficulty: "med", concept: "income elasticity", points: 1,
      prompt: "A good with an income elasticity greater than 1 is called:",
      options: ["a luxury (a normal good whose demand rises more than proportionally with income)", "an inferior good", "a Giffen good", "a necessity"], answer: 0,
      rationale: "Income elasticity > 1 identifies luxuries; between 0 and 1, necessities; below 0, inferior goods." },
    { id: "ch5_farm_paradox", chapter: 5, kind: "mc", render: "text", difficulty: "hard", concept: "elasticity application", points: 2,
      prompt: "A bumper harvest can lower farmers' total revenue because farm-product demand is typically:",
      options: ["inelastic, so the price falls more than proportionally to the rise in quantity", "elastic, so revenue rises", "unit elastic", "perfectly elastic"], answer: 0,
      rationale: "With inelastic demand, the large price drop from extra output outweighs the quantity gain, cutting revenue \u2014 the 'paradox of the bumper harvest.'" },
    { id: "ch5_elasticity_classify_num", chapter: 5, kind: "numeric", render: "text", difficulty: "med", concept: "elasticity computation", points: 2,
      prompt: "When the price of a good rises by 10%, quantity demanded falls by 25%. What is the price elasticity of demand (absolute value, 2 decimals)?",
      answer: 2.5, tolerance: 0.01,
      rationale: "Elasticity = |%\u0394Q / %\u0394P| = |\u221225% / 10%| = 2.5 (elastic)." },
    { id: "ch5_written_elasticity_pricing", chapter: 5, kind: "short", render: "text", difficulty: "hard", concept: "elasticity and pricing", points: 3,
      prompt: "A subway system wants to raise revenue by changing fares. Explain how the price elasticity of demand for subway rides determines whether it should RAISE or LOWER fares, and name one factor that makes that demand more elastic.",
      answer: null,
      rubric: "Full credit: (1) if demand is inelastic, raise fares to raise revenue; (2) if elastic, lower fares; (3) uses the total-revenue test correctly; (4) names a valid factor increasing elasticity (availability of substitutes like cars/buses, longer time horizon, fare as large share of budget). Partial credit per element.",
      rationale: "Looking for the inelastic->raise / elastic->lower logic plus a determinant of elasticity." }
    ,
    /* ==================== Chapter 6 additions ==================== */
    { id: "ch6_ceiling_binding", chapter: 6, kind: "mc", render: "text", difficulty: "med", concept: "binding price ceiling", points: 1,
      prompt: "A price ceiling is BINDING (has an effect) only when it is set:",
      options: ["below the equilibrium price", "above the equilibrium price", "at the equilibrium price", "at zero"], answer: 0,
      rationale: "A ceiling below equilibrium prevents the price from rising to clear the market, causing a shortage; above equilibrium it doesn't bind." },
    { id: "ch6_floor_binding", chapter: 6, kind: "mc", render: "text", difficulty: "med", concept: "binding price floor", points: 1,
      prompt: "A price floor is BINDING only when it is set:",
      options: ["above the equilibrium price", "below the equilibrium price", "at the equilibrium price", "at zero"], answer: 0,
      rationale: "A floor above equilibrium keeps the price from falling to clear the market, causing a surplus." },
    { id: "ch6_rent_control", chapter: 6, kind: "mc", render: "text", difficulty: "hard", concept: "price ceiling example", points: 2,
      prompt: "Rent control (a price ceiling on apartments) typically leads in the long run to:",
      options: ["a shortage of apartments and lower quality/maintenance", "an abundance of cheap high-quality apartments", "higher construction of new rentals", "no effect on the market"], answer: 0,
      rationale: "A binding ceiling causes a housing shortage; landlords also skimp on maintenance since demand exceeds supply." },
    { id: "ch6_min_wage", chapter: 6, kind: "mc", render: "text", difficulty: "hard", concept: "price floor example", points: 2,
      prompt: "A minimum wage set above the equilibrium wage is a price floor that can cause:",
      options: ["a surplus of labor (unemployment) among low-skill workers", "a shortage of workers", "wages to fall", "no change in employment ever"], answer: 0,
      rationale: "A binding wage floor makes quantity of labor supplied exceed quantity demanded \u2014 a surplus of labor, i.e., unemployment." },
    { id: "ch6_tax_burden_independent", chapter: 6, kind: "mc", render: "text", difficulty: "hard", concept: "tax incidence independence", points: 2,
      prompt: "Whether a tax is legally collected from buyers or from sellers, the economic burden (incidence):",
      options: ["is the same either way \u2014 it depends on elasticities, not on who writes the check", "always falls entirely on whoever pays the government", "falls only on sellers", "falls only on buyers"], answer: 0,
      rationale: "Incidence is determined by relative elasticities of supply and demand, not by which side is legally taxed." },
    { id: "ch6_tax_wedge_concept", chapter: 6, kind: "mc", render: "text", difficulty: "med", concept: "tax wedge", points: 1,
      prompt: "A per-unit tax on a good causes the price buyers pay and the price sellers receive to:",
      options: ["differ by the amount of the tax, with a lower quantity traded", "become equal and higher", "become equal and lower", "stay exactly the same"], answer: 0,
      rationale: "A tax drives a wedge equal to the tax between buyer and seller prices, and reduces the quantity traded." },
    { id: "ch6_shortage_nonprice", chapter: 6, kind: "mc", render: "text", difficulty: "med", concept: "consequences of ceilings", points: 1,
      prompt: "When a binding price ceiling causes a shortage, goods are often allocated by:",
      options: ["long lines or seller favoritism instead of price", "an auction to the highest bidder", "raising the price", "producing more"], answer: 0,
      rationale: "With price held down, non-price rationing (queues, favoritism, black markets) emerges to allocate the scarce good." },
    { id: "ch6_surplus_consequence", chapter: 6, kind: "mc", render: "text", difficulty: "med", concept: "consequences of floors", points: 1,
      prompt: "A binding price floor on an agricultural good tends to create:",
      options: ["a persistent surplus that the government may buy up or store", "a shortage", "market-clearing prices", "higher quantity demanded"], answer: 0,
      rationale: "A floor above equilibrium yields chronic surpluses, often addressed by government purchases or storage." },
    { id: "ch6_who_bears_inelastic", chapter: 6, kind: "mc", render: "text", difficulty: "hard", concept: "elasticity and incidence", points: 2,
      prompt: "When demand is much more inelastic than supply, most of a tax burden falls on:",
      options: ["buyers", "sellers", "the government", "no one"], answer: 0,
      rationale: "The more inelastic side of the market bears more of the tax; inelastic demand means buyers bear most of it." },
    { id: "ch6_subsidy", chapter: 6, kind: "mc", render: "text", difficulty: "hard", concept: "subsidies", points: 2,
      prompt: "A per-unit subsidy to sellers of a good will tend to:",
      options: ["lower the price buyers pay, raise the price sellers receive, and increase quantity traded", "raise the price buyers pay", "reduce quantity traded", "have no effect on quantity"], answer: 0,
      rationale: "A subsidy is like a negative tax: it lowers the buyer price, raises the effective seller price, and expands quantity." },
    { id: "ch6_ceiling_calc", chapter: 6, kind: "numeric", render: "text", difficulty: "hard", concept: "shortage size", points: 2,
      prompt: "Demand is P = 20 \u2212 Q and supply is P = 4 + Q. If a price ceiling of $8 is imposed, what is the shortage (Qd \u2212 Qs)?",
      answer: 8, tolerance: 0.01,
      rationale: "At P=8: Qd = 20\u22128 = 12; Qs = 8\u22124 = 4. Shortage = 12 \u2212 4 = 8 units." },
    { id: "ch6_floor_calc", chapter: 6, kind: "numeric", render: "text", difficulty: "hard", concept: "surplus size", points: 2,
      prompt: "Demand is P = 20 \u2212 Q and supply is P = 4 + Q. If a price floor of $14 is imposed, what is the surplus (Qs \u2212 Qd)?",
      answer: 4, tolerance: 0.01,
      rationale: "At P=14: Qs = 14\u22124 = 10; Qd = 20\u221214 = 6. Surplus = 10 \u2212 6 = 4 units." },
    { id: "ch6_price_control_tradeoff", chapter: 6, kind: "mc", render: "text", difficulty: "med", concept: "evaluating price controls", points: 1,
      prompt: "Economists often criticize price controls because they:",
      options: ["prevent prices from allocating goods efficiently, creating shortages or surpluses", "always help the intended beneficiaries", "raise total surplus", "have no side effects"], answer: 0,
      rationale: "Price controls interfere with the rationing role of prices, producing inefficiencies and often hurting those they aim to help." },
    { id: "ch6_written_rent_control", chapter: 6, kind: "short", render: "text", difficulty: "hard", concept: "price ceilings", points: 3,
      prompt: "A city imposes rent control (a binding price ceiling) to help tenants. Explain the short-run and long-run effects on the quantity and quality of rental housing, and who may be hurt.",
      answer: null,
      rubric: "Full credit: (1) short-run: modest shortage since supply/demand are inelastic; (2) long-run: larger shortage as supply falls and demand rises; (3) quality declines (less maintenance); (4) some tenants (those who can't find apartments) are hurt despite the policy's intent. Partial credit per element.",
      rationale: "Looking for shortage growing over time, quality decline, and unintended harm to some tenants." },
    { id: "ch6_written_tax_incidence", chapter: 6, kind: "short", render: "text", difficulty: "hard", concept: "tax incidence", points: 3,
      prompt: "Explain why the statement 'a tax on sellers is paid entirely by sellers' is usually wrong. What actually determines how the burden of a tax is split between buyers and sellers?",
      answer: null,
      rubric: "Full credit: (1) legal vs economic incidence differ \u2014 who writes the check doesn't determine who bears the burden; (2) sellers pass part of the tax to buyers via a higher price; (3) the split depends on relative elasticities; (4) the more inelastic side bears more. Partial credit per element.",
      rationale: "Looking for the legal-vs-economic-incidence distinction and the role of elasticities." },
    { id: "ch6_shortage_or_surplus", chapter: 6, kind: "mc", render: "text", difficulty: "easy", concept: "identifying controls", points: 1,
      prompt: "A binding price ceiling causes a ____, while a binding price floor causes a ____.",
      options: ["shortage; surplus", "surplus; shortage", "shortage; shortage", "surplus; surplus"], answer: 0,
      rationale: "Ceilings (below equilibrium) cause shortages; floors (above equilibrium) cause surpluses." }
    ,
    /* ==================== Chapter 8 additions ==================== */
    { id: "ch8_dwl_def", chapter: 8, kind: "mc", render: "text", difficulty: "easy", concept: "deadweight loss", points: 1,
      prompt: "The deadweight loss from a tax is:",
      options: ["the fall in total surplus that results from the tax distorting behavior", "the revenue the government collects", "the tax paid by buyers", "the profit sellers keep"], answer: 0,
      rationale: "Deadweight loss is lost total surplus from mutually beneficial trades that no longer occur because of the tax." },
    { id: "ch8_dwl_source", chapter: 8, kind: "mc", render: "text", difficulty: "med", concept: "source of DWL", points: 1,
      prompt: "Deadweight loss arises from a tax because the tax:",
      options: ["reduces the quantity traded below the efficient level", "raises government revenue", "is collected from sellers", "changes who is legally taxed"], answer: 0,
      rationale: "By discouraging some trades whose value exceeds cost, the tax shrinks quantity below the efficient level, destroying surplus." },
    { id: "ch8_dwl_elasticity", chapter: 8, kind: "mc", render: "text", difficulty: "hard", concept: "DWL and elasticity", points: 2,
      prompt: "For a given tax, deadweight loss is LARGER when supply and demand are:",
      options: ["more elastic", "more inelastic", "perfectly inelastic", "vertical"], answer: 0,
      rationale: "More elastic curves mean quantity responds more to the tax, so more trades are lost and deadweight loss is bigger." },
    { id: "ch8_dwl_inelastic_small", chapter: 8, kind: "mc", render: "text", difficulty: "hard", concept: "DWL and inelasticity", points: 2,
      prompt: "A tax on a good with very inelastic demand (like a necessity) tends to create:",
      options: ["a small deadweight loss because quantity changes little", "a large deadweight loss", "no revenue", "a surplus"], answer: 0,
      rationale: "Inelastic demand means quantity barely falls, so few trades are lost \u2014 small deadweight loss (a reason to tax such goods for revenue)." },
    { id: "ch8_laffer", chapter: 8, kind: "mc", render: "text", difficulty: "hard", concept: "Laffer curve", points: 2,
      prompt: "The idea that raising a tax rate can eventually REDUCE tax revenue (because the tax base shrinks) is captured by the:",
      options: ["Laffer curve", "Phillips curve", "Lorenz curve", "production possibilities frontier"], answer: 0,
      rationale: "The Laffer curve shows revenue rising then falling as the rate increases, because higher rates shrink the taxed quantity." },
    { id: "ch8_revenue_vs_rate", chapter: 8, kind: "mc", render: "text", difficulty: "med", concept: "tax revenue and rate", points: 1,
      prompt: "As a tax rate rises, tax revenue:",
      options: ["may rise at first then fall, because the quantity traded keeps shrinking", "always rises proportionally", "always falls", "stays constant"], answer: 0,
      rationale: "Revenue = tax x quantity; as the rate climbs, the shrinking quantity can eventually outweigh the higher rate." },
    { id: "ch8_dwl_grows_square", chapter: 8, kind: "mc", render: "text", difficulty: "hard", concept: "DWL scaling", points: 2,
      prompt: "If a tax triples, its deadweight loss increases by roughly a factor of:",
      options: ["9 (the square of 3)", "3", "1 (no change)", "6"], answer: 0,
      rationale: "DWL grows with the square of the tax because both the wedge and the reduction in quantity grow with the tax." },
    { id: "ch8_who_pays_dwl", chapter: 8, kind: "mc", render: "text", difficulty: "med", concept: "surplus and taxes", points: 1,
      prompt: "When a tax is imposed, the losses to buyers and sellers (lost surplus) exceed the revenue raised by an amount equal to:",
      options: ["the deadweight loss", "the tax rate", "zero", "the total surplus"], answer: 0,
      rationale: "Buyers' + sellers' surplus losses = government revenue + deadweight loss; the excess over revenue is the deadweight loss." },
    { id: "ch8_optimal_tax_base", chapter: 8, kind: "mc", render: "text", difficulty: "hard", concept: "efficient taxation", points: 2,
      prompt: "To minimize deadweight loss for a given amount of revenue, a government should prefer to tax goods whose supply and demand are:",
      options: ["relatively inelastic", "relatively elastic", "perfectly elastic", "highly substitutable"], answer: 0,
      rationale: "Taxing inelastic goods distorts quantity the least, minimizing deadweight loss per dollar of revenue." },
    { id: "ch8_dwl_calc", chapter: 8, kind: "numeric", render: "text", difficulty: "hard", concept: "computing DWL", points: 2,
      prompt: "A $4 per-unit tax reduces the quantity traded from 20 units to 14 units. What is the deadweight loss (the area of the triangle)?",
      answer: 12, tolerance: 0.01,
      rationale: "DWL = \u00bd \u00d7 tax \u00d7 \u0394Q = \u00bd \u00d7 4 \u00d7 (20 \u2212 14) = \u00bd \u00d7 4 \u00d7 6 = 12." },
    { id: "ch8_revenue_calc", chapter: 8, kind: "numeric", render: "text", difficulty: "med", concept: "computing tax revenue", points: 2,
      prompt: "A $3 per-unit tax leaves 15 units traded. How much revenue does the government collect?",
      answer: 45, tolerance: 0.01,
      rationale: "Revenue = tax \u00d7 quantity = $3 \u00d7 15 = $45." },
    { id: "ch8_total_surplus_after_tax", chapter: 8, kind: "mc", render: "text", difficulty: "med", concept: "surplus after tax", points: 1,
      prompt: "After a tax is imposed, total surplus (including government revenue) is:",
      options: ["lower than before, by the amount of the deadweight loss", "higher than before", "unchanged", "zero"], answer: 0,
      rationale: "Government revenue is a transfer, not a loss, but the deadweight loss reduces total surplus overall." },
    { id: "ch8_tax_incidence_dwl", chapter: 8, kind: "mc", render: "text", difficulty: "med", concept: "taxes and behavior", points: 1,
      prompt: "The deadweight loss of a tax comes fundamentally from:",
      options: ["changes in buyers' and sellers' behavior (fewer trades)", "the paperwork of collecting it", "the government spending it", "inflation"], answer: 0,
      rationale: "Deadweight loss reflects distorted incentives \u2014 people trade less \u2014 not administrative costs." },
    { id: "ch8_written_dwl_size", chapter: 8, kind: "short", render: "text", difficulty: "hard", concept: "determinants of DWL", points: 3,
      prompt: "Explain how the elasticities of supply and demand affect the size of the deadweight loss from a tax. Why might a government choose to tax goods like gasoline or cigarettes?",
      answer: null,
      rubric: "Full credit: (1) more elastic curves -> larger deadweight loss (quantity responds more); (2) more inelastic curves -> smaller deadweight loss; (3) gasoline/cigarettes have inelastic demand, so taxing them raises revenue with little deadweight loss; (4) (bonus) may also correct externalities. Partial credit per element.",
      rationale: "Looking for elasticity->DWL relationship and why inelastic goods are attractive tax bases." },
    { id: "ch8_written_double_tax", chapter: 8, kind: "short", render: "text", difficulty: "hard", concept: "taxes and revenue", points: 3,
      prompt: "A legislator argues that doubling a tax will double the revenue. Explain why this is usually wrong, and describe what happens to the deadweight loss when the tax doubles.",
      answer: null,
      rubric: "Full credit: (1) doubling the tax reduces the quantity traded, so revenue = tax x smaller Q rises by less than double (and may fall); (2) reference to the Laffer idea; (3) deadweight loss more than doubles \u2014 it grows with the square of the tax; (4) so the efficiency cost climbs faster than any revenue gain. Partial credit per element.",
      rationale: "Looking for the revenue-less-than-double point and DWL growing with the square of the tax." },
    { id: "ch8_transfer_vs_loss", chapter: 8, kind: "mc", render: "text", difficulty: "hard", concept: "transfer vs deadweight loss", points: 2,
      prompt: "The tax revenue collected by the government is best described as:",
      options: ["a transfer from buyers and sellers to the government, not a deadweight loss", "pure deadweight loss", "a gain to society over and above surplus", "irrelevant to welfare"], answer: 0,
      rationale: "Revenue is a transfer that can fund useful things; only the lost trades (deadweight loss) are a true efficiency cost." }
    ,
    /* ==================== Chapter 9 additions ==================== */
    { id: "ch9_explicit_implicit", chapter: 9, kind: "mc", render: "text", difficulty: "med", concept: "explicit vs implicit costs", points: 1,
      prompt: "The owner of a shop forgoes a $60,000 salary elsewhere to run her store. That forgone salary is:",
      options: ["an implicit cost", "an explicit cost", "an accounting cost", "irrelevant to economic profit"], answer: 0,
      rationale: "Implicit costs are opportunity costs that don't involve a cash outlay, like the owner's forgone salary." },
    { id: "ch9_economic_vs_accounting_profit", chapter: 9, kind: "mc", render: "text", difficulty: "hard", concept: "economic vs accounting profit", points: 2,
      prompt: "Economic profit differs from accounting profit because economic profit also subtracts:",
      options: ["implicit (opportunity) costs", "explicit costs", "revenue", "fixed costs only"], answer: 0,
      rationale: "Accounting profit subtracts only explicit costs; economic profit subtracts both explicit and implicit costs." },
    { id: "ch9_production_function", chapter: 9, kind: "mc", render: "text", difficulty: "med", concept: "production function", points: 1,
      prompt: "A production function shows the relationship between:",
      options: ["the quantity of inputs used and the quantity of output produced", "price and quantity demanded", "cost and revenue", "profit and loss"], answer: 0,
      rationale: "The production function maps inputs (like labor) to the maximum output attainable." },
    { id: "ch9_diminishing_marginal_product", chapter: 9, kind: "mc", render: "text", difficulty: "hard", concept: "diminishing marginal product", points: 2,
      prompt: "Diminishing marginal product means that as a firm adds more of one input (holding others fixed), the:",
      options: ["extra output from each additional unit of the input eventually falls", "total output falls", "input becomes free", "marginal cost falls"], answer: 0,
      rationale: "Adding more of a variable input to fixed inputs eventually yields smaller and smaller output gains \u2014 diminishing marginal product." },
    { id: "ch9_mp_mc_link", chapter: 9, kind: "mc", render: "text", difficulty: "hard", concept: "marginal product and marginal cost", points: 2,
      prompt: "When the marginal product of labor is falling, the marginal cost of output is:",
      options: ["rising", "falling", "constant", "zero"], answer: 0,
      rationale: "Diminishing marginal product means each extra unit of output requires more input, so marginal cost rises." },
    { id: "ch9_fixed_cost_def", chapter: 9, kind: "mc", render: "text", difficulty: "easy", concept: "fixed costs", points: 1,
      prompt: "Fixed costs are costs that:",
      options: ["do not vary with the quantity of output produced", "rise with each unit produced", "are always larger than variable costs", "only occur in the long run"], answer: 0,
      rationale: "Fixed costs (like rent) stay the same regardless of output in the short run." },
    { id: "ch9_avg_fixed_falls", chapter: 9, kind: "mc", render: "text", difficulty: "hard", concept: "average fixed cost", points: 2,
      prompt: "As output rises, average fixed cost (AFC):",
      options: ["always declines, because a fixed total is spread over more units", "always rises", "stays constant", "equals marginal cost"], answer: 0,
      rationale: "AFC = fixed cost / quantity, so it falls continuously as output increases (\u201cspreading the overhead\u201d)." },
    { id: "ch9_mc_atc_cross", chapter: 9, kind: "mc", render: "text", difficulty: "med", concept: "MC and ATC", points: 1,
      prompt: "The marginal-cost curve crosses the average-total-cost curve at:",
      options: ["the minimum of ATC", "the maximum of ATC", "the vertical axis", "the minimum of MC"], answer: 0,
      rationale: "When MC is below ATC it pulls the average down; above, it pulls it up; so MC crosses ATC at ATC's minimum." },
    { id: "ch9_mc_below_atc", chapter: 9, kind: "mc", render: "text", difficulty: "hard", concept: "MC-ATC relationship", points: 2,
      prompt: "Whenever marginal cost is below average total cost, average total cost must be:",
      options: ["falling", "rising", "at its minimum", "constant"], answer: 0,
      rationale: "Adding a unit that costs less than the current average pulls the average down \u2014 ATC is falling when MC < ATC." },
    { id: "ch9_efficient_scale", chapter: 9, kind: "mc", render: "text", difficulty: "med", concept: "efficient scale", points: 1,
      prompt: "The quantity that minimizes average total cost is called the firm's:",
      options: ["efficient scale", "shutdown point", "break-even quantity", "marginal quantity"], answer: 0,
      rationale: "Efficient scale is the output level where ATC is at its minimum." },
    { id: "ch9_economies_diseconomies", chapter: 9, kind: "mc", render: "text", difficulty: "hard", concept: "economies vs diseconomies of scale", points: 2,
      prompt: "When long-run average total cost RISES as output increases, a firm experiences:",
      options: ["diseconomies of scale", "economies of scale", "constant returns to scale", "diminishing marginal utility"], answer: 0,
      rationale: "Rising long-run ATC indicates diseconomies of scale, often from coordination problems in large firms." },
    { id: "ch9_short_run_long_run", chapter: 9, kind: "mc", render: "text", difficulty: "med", concept: "short vs long run costs", points: 1,
      prompt: "A key difference between the short run and long run for a firm is that in the long run:",
      options: ["all costs are variable (the firm can adjust every input, including its factory size)", "all costs are fixed", "there are no costs", "output cannot change"], answer: 0,
      rationale: "In the long run a firm can vary every input, so all costs become variable; in the short run some are fixed." },
    { id: "ch9_mc_calc", chapter: 9, kind: "numeric", render: "text", difficulty: "med", concept: "marginal cost", points: 1,
      prompt: "A firm's total cost rises from $120 at 8 units to $138 at 9 units. What is the marginal cost of the 9th unit?",
      answer: 18, tolerance: 0.01,
      rationale: "MC = \u0394TC / \u0394Q = ($138 \u2212 $120) / 1 = $18." },
    { id: "ch9_atc_calc", chapter: 9, kind: "numeric", render: "text", difficulty: "easy", concept: "average total cost", points: 1,
      prompt: "A firm produces 12 units at a total cost of $180. What is its average total cost per unit?",
      answer: 15, tolerance: 0.01,
      rationale: "ATC = total cost / quantity = $180 / 12 = $15." },
    { id: "ch9_written_economic_profit", chapter: 9, kind: "short", render: "text", difficulty: "hard", concept: "economic vs accounting profit", points: 3,
      prompt: "A woman quits a $50,000 job to open a bakery. Her bakery earns $70,000 in revenue with $30,000 in explicit costs. Explain the difference between her accounting profit and her economic profit, computing each.",
      answer: null,
      rubric: "Full credit: (1) accounting profit = revenue \u2212 explicit costs = $70,000 \u2212 $30,000 = $40,000; (2) economic profit also subtracts the $50,000 implicit (forgone salary) cost; (3) economic profit = $40,000 \u2212 $50,000 = \u2212$10,000; (4) explains that economic profit accounts for opportunity cost. Partial credit per element.",
      rationale: "Looking for both profit computations and the role of the implicit opportunity cost." },
    { id: "ch9_written_mc_shape", chapter: 9, kind: "short", render: "text", difficulty: "hard", concept: "cost curve shapes", points: 3,
      prompt: "Explain why the marginal-cost curve is typically U-shaped (falling then rising). Connect your answer to the marginal product of labor.",
      answer: null,
      rubric: "Full credit: (1) at low output, marginal product of labor rises (specialization/teamwork), so MC falls; (2) eventually diminishing marginal product sets in; (3) as marginal product falls, each extra unit of output needs more input, so MC rises; (4) hence the U shape. Partial credit per element.",
      rationale: "Looking for the inverse relationship between marginal product and marginal cost producing the U shape." }
    ,
    /* ==================== Chapter 10 additions ==================== */
    { id: "ch10_price_taker", chapter: 10, kind: "mc", render: "text", difficulty: "easy", concept: "competitive firm", points: 1,
      prompt: "A firm in a perfectly competitive market is a \u201cprice taker,\u201d meaning it:",
      options: ["must accept the market price and cannot influence it", "sets its own price freely", "faces a downward-sloping demand curve", "is the only seller"], answer: 0,
      rationale: "With many small firms selling identical products, each firm takes the market price as given." },
    { id: "ch10_mr_equals_price", chapter: 10, kind: "mc", render: "text", difficulty: "med", concept: "marginal revenue", points: 1,
      prompt: "For a competitive firm, marginal revenue equals:",
      options: ["the market price", "average total cost", "marginal cost always", "zero"], answer: 0,
      rationale: "Since a price taker sells each unit at the market price, its marginal revenue equals that price." },
    { id: "ch10_profit_max_rule", chapter: 10, kind: "mc", render: "text", difficulty: "med", concept: "profit maximization", points: 1,
      prompt: "A competitive firm maximizes profit by producing where:",
      options: ["price equals marginal cost (on the rising part of MC)", "price equals average total cost", "marginal cost is minimized", "total cost is minimized"], answer: 0,
      rationale: "Producing until P = MC captures every unit whose price covers its marginal cost." },
    { id: "ch10_shutdown_rule", chapter: 10, kind: "mc", render: "text", difficulty: "hard", concept: "shutdown rule", points: 2,
      prompt: "In the short run, a competitive firm should shut down (produce zero) if price is:",
      options: ["below average variable cost", "below average total cost", "above marginal cost", "equal to marginal revenue"], answer: 0,
      rationale: "If price can't even cover average variable cost, the firm loses less by shutting down (it still pays fixed costs either way)." },
    { id: "ch10_exit_rule", chapter: 10, kind: "mc", render: "text", difficulty: "hard", concept: "exit rule", points: 2,
      prompt: "In the LONG run, a competitive firm will exit the market if price is:",
      options: ["below average total cost", "below average variable cost", "above marginal cost", "equal to price"], answer: 0,
      rationale: "In the long run all costs are avoidable, so a firm exits when price cannot cover average total cost." },
    { id: "ch10_sunk_fixed", chapter: 10, kind: "mc", render: "text", difficulty: "hard", concept: "sunk costs and shutdown", points: 2,
      prompt: "Fixed costs are ignored in the short-run shutdown decision because they:",
      options: ["must be paid whether or not the firm produces (sunk in the short run)", "are always zero", "change with output", "are variable costs"], answer: 0,
      rationale: "Short-run fixed costs are sunk, so they don't affect the produce-or-shutdown comparison, which uses AVC." },
    { id: "ch10_supply_curve", chapter: 10, kind: "mc", render: "text", difficulty: "hard", concept: "firm supply curve", points: 2,
      prompt: "A competitive firm's short-run supply curve is:",
      options: ["its marginal-cost curve above the minimum of average variable cost", "its entire marginal-cost curve", "its average-total-cost curve", "a horizontal line at the market price"], answer: 0,
      rationale: "The firm supplies along MC, but only above minimum AVC \u2014 below that it shuts down." },
    { id: "ch10_zero_profit", chapter: 10, kind: "mc", render: "text", difficulty: "hard", concept: "long-run equilibrium", points: 2,
      prompt: "In long-run competitive equilibrium, firms earn zero economic profit because:",
      options: ["free entry and exit drive price to the minimum of average total cost", "the government caps profits", "demand is inelastic", "firms collude"], answer: 0,
      rationale: "Entry erodes profits and exit erases losses until price equals minimum ATC, leaving zero economic profit." },
    { id: "ch10_entry_effect", chapter: 10, kind: "mc", render: "text", difficulty: "med", concept: "entry and exit", points: 1,
      prompt: "If existing competitive firms are earning positive economic profit, we expect:",
      options: ["new firms to enter, increasing supply and pushing the price down", "firms to exit", "the price to rise further", "no change"], answer: 0,
      rationale: "Positive economic profit attracts entry; rising supply lowers the price until profit is competed away." },
    { id: "ch10_pmc_calc", chapter: 10, kind: "numeric", render: "text", difficulty: "med", concept: "profit-maximizing quantity", points: 2,
      prompt: "A competitive firm has marginal cost MC = 3 + 2Q. If the market price is $15, what output maximizes profit?",
      answer: 6, tolerance: 0.01,
      rationale: "Set P = MC: 15 = 3 + 2Q -> 2Q = 12 -> Q = 6." },
    { id: "ch10_profit_calc2", chapter: 10, kind: "numeric", render: "text", difficulty: "hard", concept: "firm profit", points: 2,
      prompt: "A competitive firm sells 10 units at $12 each. Its average total cost is $9 per unit. What is its total profit?",
      answer: 30, tolerance: 0.01,
      rationale: "Profit = (P \u2212 ATC) \u00d7 Q = ($12 \u2212 $9) \u00d7 10 = $30." },
    { id: "ch10_loss_calc", chapter: 10, kind: "numeric", render: "text", difficulty: "hard", concept: "firm loss", points: 2,
      prompt: "A competitive firm sells 8 units at $7 each, with an average total cost of $10 per unit. What is its profit (a loss is negative)?",
      answer: -24, tolerance: 0.01,
      rationale: "Profit = (P \u2212 ATC) \u00d7 Q = ($7 \u2212 $10) \u00d7 8 = \u2212$24 (a loss)." },
    { id: "ch10_identical_products", chapter: 10, kind: "mc", render: "text", difficulty: "easy", concept: "characteristics of competition", points: 1,
      prompt: "Which is a defining feature of a perfectly competitive market?",
      options: ["many buyers and sellers trading identical products", "a single dominant seller", "unique, differentiated products", "significant barriers to entry"], answer: 0,
      rationale: "Perfect competition features many small firms, identical products, and free entry/exit \u2014 so each firm is a price taker." },
    { id: "ch10_written_shutdown_vs_exit", chapter: 10, kind: "short", render: "text", difficulty: "hard", concept: "shutdown vs exit", points: 3,
      prompt: "Explain the difference between a firm shutting down in the short run and exiting in the long run. Which cost (AVC or ATC) does the firm compare price to in each case, and why?",
      answer: null,
      rubric: "Full credit: (1) short-run shutdown: produce if P \u2265 AVC because fixed costs are sunk; (2) long-run exit: leave if P < ATC because all costs are avoidable; (3) explains fixed costs are unavoidable short-run, avoidable long-run; (4) hence AVC short-run vs ATC long-run. Partial credit per element.",
      rationale: "Looking for AVC (short-run) vs ATC (long-run) and the sunk-cost reasoning." },
    { id: "ch10_written_zero_profit", chapter: 10, kind: "short", render: "text", difficulty: "hard", concept: "long-run equilibrium", points: 3,
      prompt: "Explain why competitive firms earn zero economic profit in the long run, and why they still stay in business despite earning \u201czero profit.\u201d",
      answer: null,
      rubric: "Full credit: (1) free entry competes away positive profit, exit erases losses; (2) price is driven to minimum ATC; (3) zero ECONOMIC profit means revenue covers all costs INCLUDING the owner's opportunity cost; (4) so the owner earns a normal return and has no reason to leave. Partial credit per element.",
      rationale: "Looking for entry/exit driving price to min ATC and the meaning of zero economic (not accounting) profit." },
    { id: "ch10_price_equals_minatc", chapter: 10, kind: "mc", render: "text", difficulty: "med", concept: "long-run price", points: 1,
      prompt: "In long-run competitive equilibrium, the market price equals:",
      options: ["the minimum of average total cost", "the maximum of ATC", "marginal revenue plus profit", "average variable cost"], answer: 0,
      rationale: "Free entry and exit push the long-run price to the minimum of ATC, where economic profit is zero." }
    ,
    /* ==================== Chapter 4 additions ==================== */
    { id: "ch4_demand_def", chapter: 4, kind: "mc", render: "text", difficulty: "easy", concept: "quantity demanded", points: 1,
      prompt: "The quantity demanded of a good is:",
      options: ["the amount buyers are willing and able to purchase at a given price", "the amount sellers offer", "the amount actually produced", "the equilibrium quantity only"], answer: 0,
      rationale: "Quantity demanded is what buyers will purchase at a specific price, holding other things constant." },
    { id: "ch4_supply_def", chapter: 4, kind: "mc", render: "text", difficulty: "easy", concept: "quantity supplied", points: 1,
      prompt: "The law of supply states that, other things equal, when the price of a good rises:",
      options: ["the quantity supplied of the good rises", "the quantity supplied falls", "supply shifts left", "demand rises"], answer: 0,
      rationale: "The law of supply: a higher price makes producing and selling more attractive, so quantity supplied rises." },
    { id: "ch4_substitute_shift", chapter: 4, kind: "mc", render: "text", difficulty: "med", concept: "substitutes", points: 1,
      prompt: "If tea and coffee are substitutes, a rise in the price of tea will cause the demand for coffee to:",
      options: ["increase (shift right)", "decrease (shift left)", "stay fixed", "become vertical"], answer: 0,
      rationale: "When a substitute becomes pricier, buyers switch toward coffee, increasing its demand." },
    { id: "ch4_complement_shift", chapter: 4, kind: "mc", render: "text", difficulty: "med", concept: "complements", points: 1,
      prompt: "If hot dogs and buns are complements, a fall in the price of hot dogs will cause the demand for buns to:",
      options: ["increase (shift right)", "decrease (shift left)", "stay fixed", "become horizontal"], answer: 0,
      rationale: "Cheaper hot dogs mean people buy more hot dogs and therefore more buns \u2014 demand for buns rises." },
    { id: "ch4_supply_determinant", chapter: 4, kind: "mc", render: "text", difficulty: "med", concept: "supply determinants", points: 1,
      prompt: "Which of the following shifts the SUPPLY curve for a good to the right?",
      options: ["a fall in the price of an input used to make it", "a rise in consumer income", "a fall in the number of sellers", "an increase in the good's own price"], answer: 0,
      rationale: "Lower input costs make production cheaper, increasing supply; the good's own price is a movement along, not a shift." },
    { id: "ch4_expectations_demand", chapter: 4, kind: "mc", render: "text", difficulty: "hard", concept: "expectations", points: 2,
      prompt: "If buyers expect the price of a good to be much higher next month, today's demand will likely:",
      options: ["increase as buyers purchase now", "decrease", "stay exactly the same", "become perfectly inelastic"], answer: 0,
      rationale: "Expecting higher future prices, buyers shift purchases to the present, raising today's demand." },
    { id: "ch4_equilibrium_def", chapter: 4, kind: "mc", render: "text", difficulty: "easy", concept: "equilibrium", points: 1,
      prompt: "At the equilibrium price in a competitive market:",
      options: ["quantity supplied equals quantity demanded", "there is a shortage", "there is a surplus", "supply exceeds demand"], answer: 0,
      rationale: "Equilibrium is where the quantity buyers want equals the quantity sellers offer \u2014 the market clears." },
    { id: "ch4_surplus_price", chapter: 4, kind: "mc", render: "text", difficulty: "med", concept: "surplus", points: 1,
      prompt: "When the price is above the equilibrium price, the market has:",
      options: ["a surplus (quantity supplied exceeds quantity demanded)", "a shortage", "equilibrium", "excess demand"], answer: 0,
      rationale: "Above equilibrium, sellers offer more than buyers want, creating a surplus that pushes price down." },
    { id: "ch4_shortage_price", chapter: 4, kind: "mc", render: "text", difficulty: "med", concept: "shortage", points: 1,
      prompt: "When the price is below the equilibrium price, the market has:",
      options: ["a shortage (quantity demanded exceeds quantity supplied)", "a surplus", "equilibrium", "excess supply"], answer: 0,
      rationale: "Below equilibrium, buyers want more than sellers offer, creating a shortage that pushes price up." },
    { id: "ch4_qd_calc2", chapter: 4, kind: "numeric", render: "text", difficulty: "easy", concept: "reading demand", points: 1,
      prompt: "A demand curve is P = 24 \u2212 2Q. At a price of 10, what is the quantity demanded?",
      answer: 7, tolerance: 0.01,
      rationale: "10 = 24 \u2212 2Q -> 2Q = 14 -> Q = 7." },
    { id: "ch4_equilibrium_calc2", chapter: 4, kind: "numeric", render: "text", difficulty: "med", concept: "solving for equilibrium", points: 2,
      prompt: "Demand is P = 30 \u2212 2Q and supply is P = 6 + Q. What is the equilibrium quantity?",
      answer: 8, tolerance: 0.01,
      rationale: "Set 30 \u2212 2Q = 6 + Q -> 24 = 3Q -> Q = 8." },
    { id: "ch4_normal_good", chapter: 4, kind: "mc", render: "text", difficulty: "med", concept: "normal goods", points: 1,
      prompt: "If a rise in income increases the demand for restaurant meals, restaurant meals are:",
      options: ["a normal good", "an inferior good", "a substitute for income", "a complement to income"], answer: 0,
      rationale: "For a normal good, higher income raises demand. (For inferior goods, higher income lowers demand.)" },
    { id: "ch4_written_equilibrium_adjust", chapter: 4, kind: "short", render: "text", difficulty: "hard", concept: "market adjustment", points: 3,
      prompt: "The current price of a good is above its equilibrium. Explain what type of imbalance exists and describe, step by step, how the market returns to equilibrium.",
      answer: null,
      rubric: "Full credit: (1) above equilibrium creates a surplus (Qs > Qd); (2) unsold inventory pressures sellers to cut price; (3) as price falls, Qd rises and Qs falls; (4) adjustment continues until Qd = Qs at the equilibrium price. Partial credit per element.",
      rationale: "Looking for surplus identification and the price-falling adjustment back to equilibrium." }
    ,
    /* ==================== Chapter 7 additions ==================== */
    { id: "ch7_ps_def", chapter: 7, kind: "mc", render: "text", difficulty: "easy", concept: "producer surplus", points: 1,
      prompt: "Producer surplus is:",
      options: ["the amount a seller receives minus the seller's cost", "the seller's total revenue", "the buyer's willingness to pay", "the market price times quantity"], answer: 0,
      rationale: "Producer surplus = price received \u2212 cost (the area above supply and below price)." },
    { id: "ch7_cs_area", chapter: 7, kind: "mc", render: "text", difficulty: "med", concept: "consumer surplus area", points: 1,
      prompt: "On a supply-and-demand graph, consumer surplus is the area:",
      options: ["below the demand curve and above the price", "above the demand curve", "below the supply curve", "below the price and above supply"], answer: 0,
      rationale: "Consumer surplus is the region below demand (willingness to pay) and above the price line." },
    { id: "ch7_ps_area", chapter: 7, kind: "mc", render: "text", difficulty: "med", concept: "producer surplus area", points: 1,
      prompt: "On a supply-and-demand graph, producer surplus is the area:",
      options: ["above the supply curve and below the price", "below the supply curve", "above the demand curve", "below the demand curve and above the price"], answer: 0,
      rationale: "Producer surplus is the region above supply (costs) and below the price line." },
    { id: "ch7_willingness_to_pay", chapter: 7, kind: "mc", render: "text", difficulty: "easy", concept: "willingness to pay", points: 1,
      prompt: "A buyer purchases a good only if the price is:",
      options: ["at or below her willingness to pay", "above her willingness to pay", "equal to the seller's cost", "equal to producer surplus"], answer: 0,
      rationale: "A rational buyer buys when the price does not exceed the maximum she is willing to pay." },
    { id: "ch7_cost_seller", chapter: 7, kind: "mc", render: "text", difficulty: "med", concept: "seller cost", points: 1,
      prompt: "A seller's \u201ccost\u201d in the producer-surplus sense is best understood as:",
      options: ["the lowest price at which she is willing to sell (her opportunity cost)", "the retail price", "her total revenue", "the buyer's surplus"], answer: 0,
      rationale: "A seller's cost is the value of everything she gives up to produce the good \u2014 the minimum acceptable price." },
    { id: "ch7_efficiency_def", chapter: 7, kind: "mc", render: "text", difficulty: "med", concept: "efficiency", points: 1,
      prompt: "An allocation of resources is \u201cefficient\u201d when it:",
      options: ["maximizes total surplus", "maximizes consumer surplus only", "gives all surplus to sellers", "equalizes everyone's income"], answer: 0,
      rationale: "Efficiency means total surplus (consumer + producer) is as large as possible." },
    { id: "ch7_equilibrium_efficient", chapter: 7, kind: "mc", render: "text", difficulty: "hard", concept: "efficiency of equilibrium", points: 2,
      prompt: "In a competitive market with no externalities, the market equilibrium allocation:",
      options: ["is efficient \u2014 it maximizes total surplus", "always favors sellers", "wastes resources", "produces too much"], answer: 0,
      rationale: "The invisible hand leads a competitive equilibrium to maximize total surplus \u2014 an efficient outcome." },
    { id: "ch7_underproduction_loss", chapter: 7, kind: "mc", render: "text", difficulty: "hard", concept: "under-production", points: 2,
      prompt: "If output is held below the equilibrium quantity, total surplus falls because:",
      options: ["some units whose value to buyers exceeds their cost are not produced", "too many units are produced", "prices are too low", "producer surplus is zero"], answer: 0,
      rationale: "Below equilibrium, beneficial trades (value > cost) go unmade, so surplus is lost." },
    { id: "ch7_overproduction_loss", chapter: 7, kind: "mc", render: "text", difficulty: "hard", concept: "over-production", points: 2,
      prompt: "If output is pushed above the equilibrium quantity, total surplus falls because:",
      options: ["some units cost more to produce than they are worth to buyers", "not enough is produced", "consumer surplus becomes infinite", "sellers earn too little"], answer: 0,
      rationale: "Above equilibrium, units are produced whose cost exceeds buyers' value, subtracting from total surplus." },
    { id: "ch7_cs_calc2", chapter: 7, kind: "numeric", render: "text", difficulty: "med", concept: "consumer surplus", points: 2,
      prompt: "The market price is $12. Four buyers value the good at $20, $16, $12, and $8. What is the total consumer surplus? (Only those who buy contribute.)",
      answer: 12, tolerance: 0.01,
      rationale: "Buyers with WTP \u2265 12 buy: ($20\u221212)+($16\u221212)+($12\u221212) = 8+4+0 = 12; the $8 buyer doesn't buy." },
    { id: "ch7_ps_calc2", chapter: 7, kind: "numeric", render: "text", difficulty: "med", concept: "producer surplus", points: 2,
      prompt: "The market price is $10. Four sellers have costs of $4, $7, $10, and $13. What is the total producer surplus? (Only sellers whose cost is at most the price sell.)",
      answer: 9, tolerance: 0.01,
      rationale: "Sellers with cost \u2264 10 sell: ($10\u22124)+($10\u22127)+($10\u221210) = 6+3+0 = 9; the $13 seller doesn't sell." },
    { id: "ch7_total_surplus_def", chapter: 7, kind: "mc", render: "text", difficulty: "easy", concept: "total surplus", points: 1,
      prompt: "Total surplus in a market equals:",
      options: ["consumer surplus plus producer surplus", "consumer surplus minus producer surplus", "revenue minus cost", "price times quantity"], answer: 0,
      rationale: "Total surplus = consumer surplus + producer surplus \u2014 the total net benefit to buyers and sellers." },
    { id: "ch7_price_transfer", chapter: 7, kind: "mc", render: "text", difficulty: "hard", concept: "price changes and surplus", points: 2,
      prompt: "A higher market price (with no change in curves) generally:",
      options: ["raises producer surplus and lowers consumer surplus", "raises both surpluses", "lowers both surpluses", "has no effect on surplus"], answer: 0,
      rationale: "A higher price transfers surplus from buyers to sellers: producer surplus up, consumer surplus down." },
    { id: "ch7_written_invisible_hand", chapter: 7, kind: "short", render: "text", difficulty: "hard", concept: "efficiency of markets", points: 3,
      prompt: "Explain how a free market, through the actions of self-interested buyers and sellers, ends up allocating goods efficiently. Reference consumer and producer surplus in your answer.",
      answer: null,
      rubric: "Full credit: (1) buyers who value the good most and sellers who can produce at lowest cost are the ones who trade; (2) this maximizes consumer + producer surplus; (3) the equilibrium quantity equates marginal value and marginal cost; (4) so the market outcome is efficient without central direction (invisible hand). Partial credit per element.",
      rationale: "Looking for the allocation to highest-value buyers/lowest-cost sellers maximizing total surplus." }
    ,
    /* ==================== HARD APPLICATION QUESTIONS ==================== */

    /* Ch3: comparative advantage reversal trap */
    { id: "ch3_hard_ca_trap", chapter: 3, kind: "mc", render: "text", difficulty: "hard", concept: "comparative advantage application", points: 3,
      prompt: "In one hour, Maya can bake 12 loaves of bread or knit 3 sweaters. In one hour, Leo can bake 4 loaves or knit 2 sweaters. Maya is faster at BOTH. Who should specialize in sweaters, and why?",
      options: ["Leo \u2014 his opportunity cost of a sweater (2 loaves) is lower than Maya's (4 loaves)",
        "Maya \u2014 she is faster at knitting sweaters", "Leo \u2014 he is slower at everything so he should knit",
        "Maya \u2014 she has the absolute advantage in both goods"],
      answer: 0,
      rationale: "Maya's OC of 1 sweater = 12/3 = 4 loaves; Leo's = 4/2 = 2 loaves. Leo gives up less bread per sweater, so despite Maya's absolute advantage, Leo has the comparative advantage in sweaters." },

    { id: "ch3_hard_terms_trade", chapter: 3, kind: "mc", render: "text", difficulty: "hard", concept: "terms of trade range", points: 3,
      prompt: "Country A's opportunity cost of 1 unit of wine is 2 units of cloth; Country B's is 5 units of cloth. For BOTH to gain, the international price of 1 wine (in cloth) must be:",
      options: ["between 2 and 5 units of cloth", "less than 2 units of cloth",
        "more than 5 units of cloth", "exactly 3.5 units of cloth only"],
      answer: 0,
      rationale: "A exports wine (its low-OC good) only if it gets more than 2 cloth; B imports wine only if it pays less than 5. Any price strictly between 2 and 5 makes both better off than producing at home." },

    /* Ch4: distinguishing shift vs movement in a scenario */
    { id: "ch4_hard_shift_scenario", chapter: 4, kind: "mc", render: "text", difficulty: "hard", concept: "shift vs movement application", points: 3,
      prompt: "The price of coffee beans (an input) rises AND, at the same time, a new study makes coffee more popular. In the coffee market, we can be CERTAIN that:",
      options: ["the equilibrium price rises, but the effect on quantity is ambiguous",
        "both price and quantity rise", "both price and quantity fall",
        "quantity rises, but the effect on price is ambiguous"],
      answer: 0,
      rationale: "Higher input cost shifts supply left (P up, Q down); higher popularity shifts demand right (P up, Q up). Both push price UP (so price definitely rises), but they push quantity in opposite directions \u2014 net effect on quantity is ambiguous." },

    { id: "ch4_hard_double_shift", chapter: 4, kind: "mc", render: "text", difficulty: "hard", concept: "simultaneous shifts", points: 3,
      prompt: "A severe frost destroys much of the orange crop, while consumer incomes also fall (oranges are a normal good). What is the certain effect on the orange market?",
      options: ["Quantity falls, but the effect on price is ambiguous",
        "Price rises and quantity rises", "Price falls and quantity falls",
        "Price rises, but the effect on quantity is ambiguous"],
      answer: 0,
      rationale: "The frost shifts supply left (P up, Q down); falling income shifts demand left (P down, Q down). Both reduce quantity (Q definitely falls), but they push price in opposite directions \u2014 net price effect is ambiguous." },

    /* Ch5: elasticity + total revenue application */
    { id: "ch5_hard_revenue_decision", chapter: 5, kind: "mc", render: "text", difficulty: "hard", concept: "elasticity revenue application", points: 3,
      prompt: "A concert promoter currently sells all 5,000 seats at $40. She finds that a 10% price increase would cut tickets sold by 4%. To maximize revenue she should:",
      options: ["raise the price \u2014 demand is inelastic (|E| = 0.4 < 1) so revenue rises",
        "lower the price \u2014 demand is elastic so revenue rises",
        "keep the price \u2014 revenue is already maximized", "raise the price only if the venue expands"],
      answer: 0,
      rationale: "|E| = 4%/10% = 0.4 < 1, so demand is inelastic: the price rise outweighs the small quantity loss, and revenue increases. She should raise the price." },

    { id: "ch5_hard_cross_elasticity", chapter: 5, kind: "mc", render: "text", difficulty: "hard", concept: "cross-price elasticity application", points: 3,
      prompt: "When a streaming service raised its price 20%, sales of a rival service rose 30%, while sales of internet-connected TVs fell 10%. What do these tell you?",
      options: ["The rival is a substitute (positive cross-elasticity); the TVs are complements (negative cross-elasticity)",
        "Both the rival and TVs are substitutes", "Both are complements",
        "The rival is a complement; the TVs are substitutes"],
      answer: 0,
      rationale: "Rival sales rose when the price rose \u2192 positive cross-price elasticity \u2192 substitute. TV sales fell when the price rose \u2192 negative cross-price elasticity \u2192 complement." },

    /* Ch6: tax incidence with elasticity reasoning */
    { id: "ch6_hard_incidence_elastic", chapter: 6, kind: "mc", render: "text", difficulty: "hard", concept: "tax incidence and elasticity", points: 3,
      prompt: "A new tax is placed on insulin, which has very inelastic demand and relatively elastic supply. Who bears most of the burden, and why?",
      options: ["Buyers \u2014 the more inelastic side of the market bears more of the tax",
        "Sellers \u2014 the tax is legally collected from them",
        "The burden splits exactly 50/50 regardless of elasticity",
        "Sellers \u2014 because supply is elastic they cannot pass any tax on"],
      answer: 0,
      rationale: "The side that is less able to change its behavior (more inelastic) bears more of the tax. With inelastic demand and elastic supply, buyers can't easily reduce purchases, so they bear most of the burden." },

    { id: "ch6_hard_min_wage_who", chapter: 6, kind: "mc", render: "text", difficulty: "hard", concept: "minimum wage incidence", points: 3,
      prompt: "An economist argues a binding minimum wage can hurt some of the very workers it aims to help. The BEST explanation is that:",
      options: ["at the higher wage, firms demand fewer workers, so some low-skill workers lose their jobs (a surplus of labor)",
        "all workers earn more, so none are hurt", "the minimum wage causes a labor shortage",
        "firms always absorb the cost with no employment effect"],
      answer: 0,
      rationale: "A binding wage floor raises quantity of labor supplied above quantity demanded \u2014 a surplus (unemployment). Workers who keep jobs earn more, but those who lose or cannot find jobs are made worse off." },

    /* Ch7: efficiency and DWL reasoning */
    { id: "ch7_hard_efficiency_reason", chapter: 7, kind: "mc", render: "text", difficulty: "hard", concept: "why equilibrium is efficient", points: 3,
      prompt: "At the competitive equilibrium, the marginal buyer values the last unit at exactly its marginal cost. If a planner FORCED one extra unit to be produced beyond equilibrium, that unit would:",
      options: ["cost more to produce than any remaining buyer values it, reducing total surplus",
        "increase total surplus because more output is always better",
        "leave total surplus unchanged", "raise consumer surplus without lowering producer surplus"],
      answer: 0,
      rationale: "Beyond equilibrium, marginal cost exceeds marginal value, so producing the extra unit destroys surplus (its cost outweighs its benefit). That's why equilibrium output is efficient." },

    /* Ch8: DWL vs revenue tradeoff numeric reasoning */
    { id: "ch8_hard_dwl_double", chapter: 8, kind: "mc", render: "text", difficulty: "hard", concept: "DWL scaling application", points: 3,
      prompt: "A $2 tax on a good creates a $6 deadweight loss. If the government raises the tax to $6 (three times as large), the deadweight loss will be APPROXIMATELY:",
      options: ["$54 \u2014 DWL grows with the square of the tax (3\u00b2 = 9 times larger)",
        "$18 \u2014 three times larger", "$6 \u2014 unchanged", "$12 \u2014 twice as large"],
      answer: 0,
      rationale: "DWL rises with the square of the tax. Tripling the tax multiplies DWL by 3\u00b2 = 9, so $6 \u00d7 9 = $54." },

    { id: "ch8_hard_tax_base_choice", chapter: 8, kind: "mc", render: "text", difficulty: "hard", concept: "efficient tax base", points: 3,
      prompt: "A government must raise a fixed amount of revenue and wants to minimize deadweight loss. Of these goods, which is the BEST to tax on efficiency grounds?",
      options: ["Table salt \u2014 demand is very inelastic, so quantity barely falls",
        "Restaurant meals \u2014 demand is elastic", "Foreign vacations \u2014 many substitutes",
        "Luxury sports cars \u2014 highly elastic demand"],
      answer: 0,
      rationale: "Taxing an inelastic good (salt) distorts quantity the least, minimizing deadweight loss per dollar of revenue. Elastic goods would see large quantity drops and big DWL." },

    /* Ch9: cost curve reasoning */
    { id: "ch9_hard_mc_atc_logic", chapter: 9, kind: "mc", render: "text", difficulty: "hard", concept: "MC-ATC averaging logic", points: 3,
      prompt: "A firm's ATC is currently $20 and falling as it produces more. What must be true about the marginal cost of the units it is currently adding?",
      options: ["Marginal cost is below $20 (that's why it's pulling the average down)",
        "Marginal cost is above $20", "Marginal cost equals $20",
        "Marginal cost must be at its own minimum"],
      answer: 0,
      rationale: "An average falls only when the incoming (marginal) value is below the current average. Since ATC is falling, MC must be below ATC ($20)." },

    { id: "ch9_hard_economic_profit", chapter: 9, kind: "mc", render: "text", difficulty: "hard", concept: "economic profit reasoning", points: 3,
      prompt: "An entrepreneur's firm has $500,000 revenue and $450,000 in explicit costs, giving $50,000 accounting profit. She gave up a $70,000 salary to run it. Her economic profit is:",
      options: ["\u2212$20,000 \u2014 she'd be $20,000 better off at her old job",
        "$50,000 \u2014 the same as accounting profit", "$120,000 \u2014 adding back her salary",
        "$0 \u2014 economic profit is always zero"],
      answer: 0,
      rationale: "Economic profit = accounting profit \u2212 implicit costs = $50,000 \u2212 $70,000 = \u2212$20,000. The negative figure means her resources (her time) would earn more elsewhere." },

    /* Ch10: shutdown vs exit numeric application */
    { id: "ch10_hard_shutdown_numeric", chapter: 10, kind: "mc", render: "text", difficulty: "hard", concept: "shutdown decision application", points: 3,
      prompt: "A competitive firm faces a price of $8. At its best output, ATC = $11 and AVC = $7. In the SHORT run the firm should:",
      options: ["keep producing \u2014 price ($8) covers AVC ($7), so operating loses less than shutting down",
        "shut down \u2014 price is below ATC", "shut down \u2014 the firm is making a loss",
        "keep producing \u2014 because price is below ATC it will earn a profit"],
      answer: 0,
      rationale: "Short-run rule: operate if P \u2265 AVC. Here $8 > $7, so producing covers all variable cost plus some fixed cost \u2014 the loss is smaller than the fixed cost paid if shut down. (It's still a loss since P < ATC, but operating is the lesser loss.)" },

    { id: "ch10_hard_longrun_entry", chapter: 10, kind: "mc", render: "text", difficulty: "hard", concept: "long-run adjustment", points: 3,
      prompt: "In a competitive industry, firms currently earn positive economic profit. Predict the long-run sequence of events.",
      options: ["New firms enter \u2192 market supply rises \u2192 price falls \u2192 profit shrinks to zero at min ATC",
        "Firms exit \u2192 supply falls \u2192 price rises \u2192 profit grows",
        "Nothing changes \u2014 profits persist forever",
        "Existing firms raise their prices to lock in profit"],
      answer: 0,
      rationale: "Positive economic profit attracts entry. Entry increases supply, driving price down, until price equals minimum ATC and economic profit is zero \u2014 the long-run equilibrium." }
    ,
    /* ==================== Chapter 11 — Monopoly ==================== */
    { id: "ch11_source_monopoly", chapter: 11, kind: "mc", render: "text", difficulty: "easy", concept: "barriers to entry", points: 1,
      prompt: "The fundamental cause of any monopoly is:",
      options: ["barriers to entry that keep other firms out", "high consumer demand",
        "low production costs", "government price controls"], answer: 0,
      rationale: "A monopoly persists only because barriers to entry (a key resource, a government-granted right, or natural cost advantages) prevent competitors from entering." },
    { id: "ch11_natural_monopoly", chapter: 11, kind: "mc", render: "text", difficulty: "hard", concept: "natural monopoly", points: 3,
      prompt: "A 'natural monopoly' arises when:",
      options: ["a single firm can supply the whole market at lower average cost than two or more firms could (economies of scale over the relevant range)",
        "a firm owns a natural resource", "the government bans competition",
        "the product is a natural good like water from a spring"], answer: 0,
      rationale: "A natural monopoly occurs when average total cost keeps falling over the entire relevant range of output, so one firm serves the market more cheaply than several \u2014 e.g., water distribution." },
    { id: "ch11_price_maker", chapter: 11, kind: "mc", render: "text", difficulty: "easy", concept: "price maker", points: 1,
      prompt: "Unlike a competitive firm, a monopolist is a 'price maker,' which means it:",
      options: ["faces the downward-sloping market demand curve and chooses a point on it",
        "can charge any price and sell any quantity", "must accept the market price",
        "has a horizontal demand curve"], answer: 0,
      rationale: "A monopoly IS the industry, so it faces the whole downward-sloping demand curve; raising price reduces quantity sold." },
    { id: "ch11_mr_less_price", chapter: 11, kind: "mc", render: "text", difficulty: "hard", concept: "marginal revenue two effects", points: 3,
      prompt: "For a monopolist, selling one more unit has two effects on revenue. They are:",
      options: ["an output effect (more units sold) and a price effect (lower price on all units)",
        "a cost effect and a demand effect", "an income effect and a substitution effect",
        "only the output effect \u2014 there is no price effect"], answer: 0,
      rationale: "MR = price MINUS the revenue lost from cutting price on all prior units. The output effect adds revenue; the price effect subtracts it, so MR < price." },
    { id: "ch11_profit_max_rule", chapter: 11, kind: "mc", render: "text", difficulty: "med", concept: "monopoly profit maximization", points: 1,
      prompt: "A monopolist maximizes profit by choosing the quantity where:",
      options: ["marginal revenue equals marginal cost", "price equals marginal cost",
        "price equals average total cost", "marginal revenue equals price"], answer: 0,
      rationale: "Like any firm, a monopoly sets MR = MC \u2014 but then charges the higher price the demand curve allows at that quantity." },
    { id: "ch11_no_supply_curve", chapter: 11, kind: "mc", render: "text", difficulty: "hard", concept: "monopoly has no supply curve", points: 3,
      prompt: "Why does a monopoly NOT have a supply curve (unlike a competitive firm)?",
      options: ["Its output depends on the shape of demand, not just price \u2014 the same price can map to different quantities",
        "It always produces the same quantity", "It never responds to costs",
        "Because it has no marginal cost curve"], answer: 0,
      rationale: "A competitive firm's supply is its MC curve because it takes price as given. A monopoly chooses price AND quantity together based on demand, so there's no single price-to-quantity mapping." },
    { id: "ch11_dwl_source", chapter: 11, kind: "mc", render: "text", difficulty: "hard", concept: "monopoly inefficiency", points: 3,
      prompt: "The deadweight loss of monopoly arises because the monopolist produces a quantity where:",
      options: ["price exceeds marginal cost \u2014 some units buyers value above cost go unproduced",
        "price is below marginal cost", "price equals marginal cost",
        "average total cost is minimized"], answer: 0,
      rationale: "By restricting output to raise price, the monopoly leaves P > MC. Units that buyers value above their cost aren't produced \u2014 that lost surplus is the deadweight loss." },
    { id: "ch11_vs_competition", chapter: 11, kind: "mc", render: "text", difficulty: "med", concept: "monopoly vs competition outcome", points: 2,
      prompt: "Compared with a competitive market, a monopoly typically produces:",
      options: ["less output and charges a higher price", "more output at a lower price",
        "the same output at a higher price", "more output at the same price"], answer: 0,
      rationale: "The monopoly restricts output (Qm < Qc) to push price above marginal cost \u2014 lower quantity, higher price than competition." },
    { id: "ch11_price_discrimination", chapter: 11, kind: "mc", render: "text", difficulty: "hard", concept: "price discrimination", points: 3,
      prompt: "Price discrimination (charging different buyers different prices) requires that the firm:",
      options: ["has market power and can prevent resale between buyers",
        "is a price taker", "faces a horizontal demand curve",
        "charges everyone the same price"], answer: 0,
      rationale: "To price-discriminate a firm needs market power, a way to sort buyers by willingness to pay, and the ability to stop low-price buyers reselling to high-price ones." },
    { id: "ch11_perfect_pd", chapter: 11, kind: "mc", render: "text", difficulty: "hard", concept: "perfect price discrimination", points: 3,
      prompt: "Under PERFECT price discrimination (each buyer charged their exact willingness to pay), what happens to deadweight loss and consumer surplus?",
      options: ["Deadweight loss disappears (efficient output), but the firm captures all surplus \u2014 consumer surplus is zero",
        "Both rise", "Deadweight loss rises and consumer surplus rises",
        "Nothing changes relative to single-price monopoly"], answer: 0,
      rationale: "Perfect price discrimination leads the monopoly to sell to every buyer whose value exceeds cost (efficient quantity, no DWL), but it extracts the entire surplus as profit, leaving buyers with none." },
    { id: "ch11_regulation", chapter: 11, kind: "mc", render: "text", difficulty: "hard", concept: "regulating natural monopoly", points: 3,
      prompt: "If a regulator forces a natural monopoly to price at marginal cost, a problem arises because:",
      options: ["with falling average cost, MC lies below ATC, so pricing at MC means the firm makes losses",
        "the firm would earn excessive profit", "output would fall to zero",
        "marginal cost pricing is always efficient with no downside"], answer: 0,
      rationale: "For a natural monopoly, ATC is still falling, so MC < ATC. Marginal-cost pricing sets price below average cost, causing losses \u2014 the firm needs a subsidy or must be allowed average-cost pricing." },
    { id: "ch11_patent_tradeoff", chapter: 11, kind: "mc", render: "text", difficulty: "hard", concept: "patents tradeoff", points: 3,
      prompt: "Patents grant temporary monopoly power. The central tradeoff of patent policy is:",
      options: ["higher prices and deadweight loss now, versus stronger incentives to innovate",
        "lower prices now versus lower innovation", "no tradeoff \u2014 patents are pure benefit",
        "more competition now versus less later"], answer: 0,
      rationale: "Patents create monopoly pricing (a cost to consumers today) in exchange for the incentive to invest in research and innovation (a benefit over time)." },
    { id: "ch11_markup_elasticity", chapter: 11, kind: "mc", render: "text", difficulty: "hard", concept: "markup and elasticity", points: 3,
      prompt: "A monopolist facing MORE elastic demand will tend to set a markup over marginal cost that is:",
      options: ["smaller \u2014 elastic demand punishes high prices with big quantity losses",
        "larger \u2014 elastic demand allows bigger markups", "unaffected by elasticity",
        "always exactly double marginal cost"], answer: 0,
      rationale: "The more elastic demand is, the more customers a monopoly loses by raising price, so its profit-maximizing markup over MC is smaller." },
    { id: "ch11_numeric_mr", chapter: 11, kind: "numeric", render: "text", difficulty: "hard", concept: "monopoly MR=MC", points: 2,
      prompt: "A monopolist has demand P = 100 \u2212 2Q (so MR = 100 \u2212 4Q) and constant MC = 20. What quantity maximizes profit?",
      answer: 20, tolerance: 0.01,
      rationale: "Set MR = MC: 100 \u2212 4Q = 20 \u2192 4Q = 80 \u2192 Q = 20." },
    { id: "ch11_numeric_price", chapter: 11, kind: "numeric", render: "text", difficulty: "hard", concept: "monopoly price", points: 2,
      prompt: "A monopolist has demand P = 100 \u2212 2Q and MC = 20, and produces the profit-maximizing quantity Q = 20. What price does it charge?",
      answer: 60, tolerance: 0.01,
      rationale: "Plug Q = 20 into demand: P = 100 \u2212 2(20) = 60. Note P ($60) far exceeds MC ($20) \u2014 the monopoly markup." },
    { id: "ch11_written_dwl", chapter: 11, kind: "short", render: "text", difficulty: "hard", concept: "why monopoly is inefficient", points: 3,
      prompt: "Explain why a single-price monopoly produces an inefficient outcome. In your answer, describe what happens to the quantity produced, the relationship between price and marginal cost, and who is harmed.",
      answer: null,
      rubric: "Full credit: (1) monopoly sets MR=MC and restricts output below the competitive/efficient level; (2) this leaves price above marginal cost; (3) units whose value exceeds cost go unproduced \u2014 deadweight loss; (4) consumers are harmed (higher price, less quantity), and total surplus falls. Partial credit per element.",
      rationale: "Looking for output restriction, P > MC, deadweight loss, and harm to consumers/total surplus." },
    { id: "ch11_written_price_disc", chapter: 11, kind: "short", render: "text", difficulty: "hard", concept: "price discrimination analysis", points: 3,
      prompt: "Movie theaters charge lower prices to students and seniors. Explain how this is price discrimination, what conditions make it possible, and why it can actually INCREASE total surplus compared to a single price.",
      answer: null,
      rubric: "Full credit: (1) different groups charged different prices based on willingness to pay / elasticity; (2) requires market power, ability to sort groups (ID), and no resale; (3) it can raise output by serving price-sensitive buyers who wouldn't buy at the single price; (4) more units traded \u2192 smaller deadweight loss / higher total surplus. Partial credit per element.",
      rationale: "Looking for the sorting mechanism, the no-resale/market-power conditions, and the efficiency gain from serving more buyers." },
    { id: "ch11_antitrust", chapter: 11, kind: "mc", render: "text", difficulty: "med", concept: "public policy toward monopoly", points: 2,
      prompt: "Which is a common public-policy response to the problems caused by monopoly?",
      options: ["antitrust laws that block mergers or break up firms to promote competition",
        "guaranteeing every firm a monopoly", "banning all large firms",
        "eliminating patents entirely"], answer: 0,
      rationale: "Governments use antitrust law (blocking anticompetitive mergers, prosecuting collusion, sometimes breaking up firms), regulation, or public ownership to address monopoly power." },
    { id: "ch11_two_effects_calc", chapter: 11, kind: "mc", render: "text", difficulty: "hard", concept: "marginal revenue can be negative", points: 3,
      prompt: "A monopolist currently sells 10 units at $8. To sell an 11th unit it must drop the price to $7.50 on ALL units. Its marginal revenue from the 11th unit is:",
      options: ["$2.50 \u2014 the $7.50 from the new unit minus $5.00 lost on the original 10",
        "$7.50 \u2014 the price of the new unit", "$8.00", "$82.50"], answer: 0,
      rationale: "New revenue = 11 \u00d7 $7.50 = $82.50; old = 10 \u00d7 $8 = $80. MR = $82.50 \u2212 $80 = $2.50. The price effect ($0.50 \u00d7 10 = $5 lost) makes MR far below the $7.50 price." },
    { id: "ch11_welfare_transfer", chapter: 11, kind: "mc", render: "text", difficulty: "hard", concept: "monopoly welfare vs transfer", points: 3,
      prompt: "When a competitive market becomes a monopoly, the higher price causes a transfer from consumers to the firm PLUS a deadweight loss. The deadweight loss specifically represents:",
      options: ["surplus that disappears entirely because efficient trades no longer happen",
        "profit gained by the monopolist", "consumer surplus transferred to the firm",
        "the firm's fixed costs"], answer: 0,
      rationale: "The transfer (higher price on units still sold) moves surplus from consumers to the monopoly \u2014 no net loss. The deadweight loss is different: it's surplus that vanishes because units that should be traded aren't." }
    ,
    /* ==================== Chapter 12 — Monopolistic Competition ==================== */
    { id: "ch12_features", chapter: 12, kind: "mc", render: "text", difficulty: "easy", concept: "monopolistic competition features", points: 1,
      prompt: "A monopolistically competitive market is characterized by:",
      options: ["many firms selling similar but differentiated products, with free entry and exit",
        "a single seller", "a few interdependent firms", "identical products and price-taking firms"], answer: 0,
      rationale: "Monopolistic competition combines many firms and free entry (like competition) with product differentiation that gives each firm a bit of pricing power (like monopoly)." },
    { id: "ch12_differentiation", chapter: 12, kind: "mc", render: "text", difficulty: "med", concept: "product differentiation", points: 1,
      prompt: "Product differentiation gives a monopolistically competitive firm:",
      options: ["a downward-sloping demand curve, so it has some control over price",
        "a horizontal demand curve", "no customers", "the ability to set any price with no loss of sales"], answer: 0,
      rationale: "Because its product is distinct, the firm can raise price and still keep some loyal customers \u2014 hence a downward-sloping (though elastic) demand curve." },
    { id: "ch12_sr_profit", chapter: 12, kind: "mc", render: "text", difficulty: "med", concept: "short-run profit", points: 1,
      prompt: "In the SHORT run, a monopolistically competitive firm:",
      options: ["can earn economic profits or losses, like a monopoly", "always earns zero profit",
        "must be a price taker", "always shuts down"], answer: 0,
      rationale: "In the short run, entry hasn't adjusted, so these firms can earn profit or loss depending on demand relative to cost." },
    { id: "ch12_lr_entry", chapter: 12, kind: "mc", render: "text", difficulty: "hard", concept: "long-run entry", points: 3,
      prompt: "If monopolistically competitive firms are earning economic profit, the long-run adjustment is:",
      options: ["new firms enter, stealing customers, shifting each firm's demand left until profit is zero",
        "firms exit until profit rises", "prices rise indefinitely",
        "nothing \u2014 profits persist"], answer: 0,
      rationale: "Free entry means profits attract new differentiated products. Each existing firm's demand shifts left and becomes more elastic until economic profit reaches zero (demand tangent to ATC)." },
    { id: "ch12_excess_capacity", chapter: 12, kind: "mc", render: "text", difficulty: "hard", concept: "excess capacity", points: 3,
      prompt: "In long-run equilibrium, a monopolistically competitive firm produces on the downward-sloping part of its ATC curve. This means it has:",
      options: ["excess capacity \u2014 it produces below the efficient scale (minimum ATC)",
        "no excess capacity", "the lowest possible average cost",
        "a horizontal demand curve"], answer: 0,
      rationale: "Because demand is tangent to ATC on its downward-sloping portion (not the minimum), the firm could lower average cost by producing more \u2014 it operates with excess capacity." },
    { id: "ch12_markup_price", chapter: 12, kind: "mc", render: "text", difficulty: "hard", concept: "price above MC", points: 3,
      prompt: "Even in long-run equilibrium (zero profit), a monopolistically competitive firm charges a price that:",
      options: ["exceeds marginal cost, because demand slopes downward",
        "equals marginal cost", "is below marginal cost", "equals marginal revenue"], answer: 0,
      rationale: "Zero profit means P = ATC, but because the demand curve slopes down, that point still has P > MC \u2014 unlike perfect competition where P = MC." },
    { id: "ch12_vs_perfect_comp", chapter: 12, kind: "mc", render: "text", difficulty: "hard", concept: "comparison to competition", points: 3,
      prompt: "Compared with perfect competition, monopolistic competition is 'inefficient' mainly because:",
      options: ["price exceeds marginal cost and firms have excess capacity",
        "firms earn large long-run profits", "there are too few products",
        "products are identical"], answer: 0,
      rationale: "The markup (P > MC) means some mutually beneficial trades don't happen, and firms don't reach minimum ATC (excess capacity). But product variety is a benefit that partly offsets this." },
    { id: "ch12_advertising_debate", chapter: 12, kind: "mc", render: "text", difficulty: "hard", concept: "advertising", points: 3,
      prompt: "Economists debate advertising. The critique that advertising is socially WASTEFUL argues that it:",
      options: ["manipulates tastes and impedes competition without adding real information",
        "always provides useful information", "lowers prices for consumers",
        "has no effect on demand"], answer: 0,
      rationale: "Critics say advertising manipulates preferences and builds brand loyalty that reduces competition; defenders argue it informs consumers and can intensify competition. Both views appear in the debate." },
    { id: "ch12_brand_names", chapter: 12, kind: "mc", render: "text", difficulty: "hard", concept: "brand names", points: 3,
      prompt: "A defense of brand names is that they:",
      options: ["give firms an incentive to maintain quality and give consumers information about consistency",
        "always raise prices without benefit", "reduce product variety",
        "eliminate competition"], answer: 0,
      rationale: "Brands can signal consistent quality and give firms a reputational incentive to keep quality high, which benefits consumers \u2014 though critics argue they mainly create artificial differentiation." },
    { id: "ch12_variety_benefit", chapter: 12, kind: "mc", render: "text", difficulty: "hard", concept: "product variety externality", points: 3,
      prompt: "When a new firm enters a monopolistically competitive market, it creates a positive 'product-variety' externality because:",
      options: ["consumers gain surplus from having a new differentiated option to choose from",
        "it lowers all firms' costs", "it eliminates deadweight loss",
        "it forces other firms to exit"], answer: 0,
      rationale: "A new product gives consumers additional variety they value \u2014 a benefit the entrant doesn't capture. (There's also a business-stealing externality that works the other way.)" },
    { id: "ch12_business_stealing", chapter: 12, kind: "mc", render: "text", difficulty: "hard", concept: "business-stealing externality", points: 3,
      prompt: "The 'business-stealing' externality of entry in monopolistic competition refers to the fact that a new firm:",
      options: ["takes customers and profit away from existing firms, a cost it doesn't bear",
        "always benefits existing firms", "reduces total market output",
        "lowers consumer variety"], answer: 0,
      rationale: "Entry draws customers from incumbents, reducing their profit \u2014 a negative externality on rivals. Whether entry is socially excessive or insufficient depends on how this balances against the variety benefit." },
    { id: "ch12_examples", chapter: 12, kind: "mc", render: "text", difficulty: "easy", concept: "identifying market structure", points: 1,
      prompt: "Which is the best real-world example of monopolistic competition?",
      options: ["restaurants in a large city", "the local electricity distributor",
        "the market for wheat", "commercial aircraft manufacturing (Boeing/Airbus)"], answer: 0,
      rationale: "Restaurants are many, differentiated (cuisine, location, atmosphere), and easy to enter/exit \u2014 classic monopolistic competition. Electricity is a natural monopoly; wheat is competitive; aircraft is oligopoly." },
    { id: "ch12_demand_elastic", chapter: 12, kind: "mc", render: "text", difficulty: "hard", concept: "demand elasticity in mon. comp.", points: 3,
      prompt: "A monopolistically competitive firm's demand is MORE elastic than a monopolist's because:",
      options: ["close substitutes from rival firms are available, so customers can switch",
        "it sells a unique product", "it faces no competition",
        "it is a price taker"], answer: 0,
      rationale: "With many differentiated rivals offering close substitutes, a firm that raises price loses more customers than a pure monopoly would \u2014 its demand is more elastic (though still downward-sloping)." },
    { id: "ch12_written_lr", chapter: 12, kind: "short", render: "text", difficulty: "hard", concept: "long-run equilibrium analysis", points: 3,
      prompt: "Describe the long-run equilibrium of a monopolistically competitive firm. Explain why economic profit is zero yet the outcome still differs from perfect competition in two important ways.",
      answer: null,
      rubric: "Full credit: (1) entry/exit drives demand to tangency with ATC \u2192 zero economic profit; (2) difference 1: price exceeds marginal cost (a markup, some lost trades); (3) difference 2: firm produces below efficient scale (excess capacity); (4) but consumers gain product variety. Partial credit per element.",
      rationale: "Looking for zero-profit tangency plus the P>MC markup and excess-capacity differences from perfect competition." },
    { id: "ch12_written_advertising", chapter: 12, kind: "short", render: "text", difficulty: "hard", concept: "advertising debate", points: 3,
      prompt: "Present both sides of the economic debate over advertising: one argument that it is socially valuable and one that it is wasteful. Then explain how advertising as a 'signal of quality' can be informative even when the ad's content is uninformative.",
      answer: null,
      rubric: "Full credit: (1) valuable: conveys information, promotes competition, lowers search costs; (2) wasteful: manipulates tastes, builds barriers, costly non-price competition; (3) signaling: a firm willing to spend heavily on ads signals it expects repeat business, which only high-quality firms expect \u2014 so ad spending itself is informative regardless of content. Partial credit per element.",
      rationale: "Looking for both sides of the debate plus the willingness-to-spend signaling argument." },
    { id: "ch12_efficient_scale_gap", chapter: 12, kind: "mc", render: "text", difficulty: "hard", concept: "excess capacity implication", points: 3,
      prompt: "Because a monopolistically competitive firm operates with excess capacity, it could reduce its average cost by producing more. Why doesn't it?",
      options: ["Selling more would require cutting price along its downward-sloping demand, which isn't profitable at the margin",
        "It is legally prohibited", "Its costs would rise to infinity",
        "It has no unused capacity"], answer: 0,
      rationale: "The firm stops where MR = MC. Producing more would need a lower price on its downward-sloping demand, and beyond MR=MC that reduces profit \u2014 so it rationally leaves capacity unused." }
    ,
    /* ==================== Chapter 13 — Oligopoly ==================== */
    { id: "ch13_definition", chapter: 13, kind: "mc", render: "text", difficulty: "easy", concept: "oligopoly definition", points: 1,
      prompt: "An oligopoly is a market with:",
      options: ["only a few sellers, whose decisions are interdependent", "one seller",
        "many sellers of identical goods", "many sellers of differentiated goods"], answer: 0,
      rationale: "Oligopoly means a few firms dominate; each is large enough that its actions affect rivals, so their decisions are strategically interdependent." },
    { id: "ch13_interdependence", chapter: 13, kind: "mc", render: "text", difficulty: "med", concept: "strategic interdependence", points: 1,
      prompt: "The key feature that makes oligopoly analysis different from other market structures is:",
      options: ["each firm must consider how rivals will react to its decisions",
        "firms ignore each other completely", "there is no competition",
        "products are always identical"], answer: 0,
      rationale: "With only a few firms, each one's best move depends on what the others do \u2014 strategic interdependence \u2014 which is why game theory is used to analyze oligopoly." },
    { id: "ch13_collusion", chapter: 13, kind: "mc", render: "text", difficulty: "med", concept: "collusion and cartels", points: 1,
      prompt: "When oligopolists collude to act like a single monopoly, they form a:",
      options: ["cartel, agreeing on quantity or price", "competitive fringe",
        "natural monopoly", "perfectly competitive market"], answer: 0,
      rationale: "A cartel is a group of firms coordinating output/price to capture monopoly profits (e.g., OPEC). Such agreements are illegal in many countries and hard to sustain." },
    { id: "ch13_cartel_unstable", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "why cartels break down", points: 3,
      prompt: "Cartels tend to be unstable because each member has an incentive to:",
      options: ["cheat by producing more than its quota, since price still exceeds its marginal cost",
        "produce less than agreed", "raise its price above the cartel price",
        "exit the market"], answer: 0,
      rationale: "At the cartel (monopoly) price, each firm's MC is below price, so producing extra units is individually profitable. This temptation to cheat undermines the agreement." },
    { id: "ch13_prisoners_dilemma", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "prisoners' dilemma", points: 3,
      prompt: "The prisoners' dilemma explains oligopoly behavior by showing that:",
      options: ["individually rational choices (each firm producing more) lead to an outcome worse for both than cooperation",
        "cooperation is always the dominant strategy", "firms always achieve the monopoly outcome",
        "there is never any conflict of interest"], answer: 0,
      rationale: "Each firm's dominant strategy is to produce a high quantity (defect), but when both do, they end up with lower joint profit than if both had cooperated \u2014 the dilemma." },
    { id: "ch13_dominant_strategy", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "dominant strategy", points: 3,
      prompt: "A 'dominant strategy' in game theory is one that:",
      options: ["is best for a player regardless of what the other players do",
        "is best only if rivals cooperate", "leads to the worst outcome",
        "requires coordination with rivals"], answer: 0,
      rationale: "A dominant strategy yields a higher payoff than any alternative no matter what opponents choose. When each player has one, the outcome is predictable (often a dilemma)." },
    { id: "ch13_nash", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "Nash equilibrium", points: 3,
      prompt: "A Nash equilibrium is a situation in which:",
      options: ["each player chooses their best strategy given the strategies chosen by all others",
        "all players cooperate perfectly", "one player controls the outcome",
        "no player has any strategy"], answer: 0,
      rationale: "At a Nash equilibrium no player can gain by unilaterally changing strategy, given what everyone else is doing \u2014 it's self-enforcing but need not be jointly optimal." },
    { id: "ch13_output_effect", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "two effects on oligopolist", points: 3,
      prompt: "When an oligopolist considers raising its output, it weighs the output effect (more units at the price) against the price effect (lower price on all units). Compared with a monopolist, an oligopolist tends to give MORE weight to the output effect because:",
      options: ["it only bears the price-effect loss on its OWN units, not the whole market's",
        "it faces no price effect at all", "it ignores marginal cost",
        "it is a price taker"], answer: 0,
      rationale: "Each oligopolist internalizes the price drop only on its own sales, not rivals', so it's more tempted to expand output than a monopoly \u2014 pushing the market toward more output than monopoly but less than competition." },
    { id: "ch13_size_effect", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "number of firms and competitiveness", points: 3,
      prompt: "As the number of firms in an oligopoly grows very large, the market outcome approaches:",
      options: ["the perfectly competitive outcome (price near marginal cost)",
        "the monopoly outcome", "zero output", "a cartel"], answer: 0,
      rationale: "More firms means each gives less weight to the price effect, so output rises and price falls toward marginal cost \u2014 approaching perfect competition as the number grows large." },
    { id: "ch13_repeated_game", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "repeated games and cooperation", points: 3,
      prompt: "Cooperation among oligopolists is easier to sustain when the game is REPEATED because:",
      options: ["firms can punish cheating in future periods (e.g., trigger strategies), deterring defection today",
        "repetition removes the incentive to compete", "there is no way to detect cheating",
        "future profits don't matter"], answer: 0,
      rationale: "In repeated interaction, the threat of future retaliation (reverting to competition if anyone cheats) can make cooperation individually rational \u2014 sustaining collusion that would collapse in a one-shot game." },
    { id: "ch13_antitrust_oligopoly", chapter: 13, kind: "mc", render: "text", difficulty: "med", concept: "antitrust and oligopoly", points: 2,
      prompt: "Antitrust laws generally treat explicit price-fixing agreements among oligopolists as:",
      options: ["illegal, because they harm consumers by raising prices",
        "legal and encouraged", "efficient and welfare-enhancing",
        "irrelevant to consumer welfare"], answer: 0,
      rationale: "Explicit collusion (price-fixing, bid-rigging) is per se illegal in most jurisdictions because it mimics monopoly, raising prices and reducing output at consumers' expense." },
    { id: "ch13_tit_for_tat", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "punishment strategies", points: 3,
      prompt: "In a repeated prisoners' dilemma between two firms, a 'grim trigger' strategy means:",
      options: ["cooperate until the rival cheats, then produce the competitive quantity forever after",
        "always defect", "always cooperate no matter what",
        "randomly choose each period"], answer: 0,
      rationale: "Grim trigger sustains cooperation by threatening permanent punishment: cooperate as long as the rival does, but if they ever cheat, revert to the competitive (low-profit) outcome forever." },
    { id: "ch13_public_goods_link", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "prisoners' dilemma applications", points: 3,
      prompt: "The prisoners' dilemma logic ALSO explains why:",
      options: ["arms races, overfishing, and advertising wars occur despite hurting all participants",
        "cooperation is always automatic", "monopolies never form",
        "markets are always efficient"], answer: 0,
      rationale: "Many social situations share the structure: each party's dominant strategy (arm, overfish, advertise more) leads to a collectively worse outcome \u2014 the same dilemma as oligopoly output choices." },
    { id: "ch13_written_cartel", chapter: 13, kind: "short", render: "text", difficulty: "hard", concept: "cartel instability", points: 3,
      prompt: "Two firms form a cartel to split monopoly profits. Explain, using the logic of the prisoners' dilemma, why each firm is tempted to cheat and why the cartel is likely to break down. What might sustain cooperation?",
      answer: null,
      rubric: "Full credit: (1) at the cartel price, each firm's MC is below price, so producing extra is individually profitable \u2014 the incentive to cheat; (2) if both cheat, output rises and profits fall toward the competitive level (the dilemma); (3) so the cooperative outcome isn't a Nash equilibrium in a one-shot game; (4) repeated interaction with punishment (trigger strategies) or enforceable agreements can sustain cooperation. Partial credit per element.",
      rationale: "Looking for the MC<price cheating incentive, the dilemma structure, and repeated-game/punishment as a sustaining mechanism." },
    { id: "ch13_written_pd", chapter: 13, kind: "short", render: "text", difficulty: "hard", concept: "prisoners' dilemma structure", points: 3,
      prompt: "Explain what a dominant strategy and a Nash equilibrium are, and use them to describe the outcome of a one-shot prisoners' dilemma between two firms deciding whether to keep output low (cooperate) or high (defect).",
      answer: null,
      rubric: "Full credit: (1) dominant strategy = best regardless of the other's choice; (2) Nash equilibrium = each best-responds to the other; (3) each firm's dominant strategy is high output (defect); (4) so the Nash equilibrium is both defect \u2014 worse for both than mutual cooperation. Partial credit per element.",
      rationale: "Looking for correct definitions and the both-defect Nash outcome that's jointly worse than cooperation." },
    { id: "ch13_concentration", chapter: 13, kind: "mc", render: "text", difficulty: "med", concept: "measuring market power", points: 2,
      prompt: "A 'concentration ratio' measures:",
      options: ["the share of total market output produced by the largest few firms",
        "the number of consumers", "the price elasticity of demand",
        "a firm's marginal cost"], answer: 0,
      rationale: "The concentration ratio (e.g., the four-firm ratio) sums the market shares of the largest firms \u2014 a higher ratio suggests a more concentrated, oligopolistic market." }
    ,
    /* ==================== Chapter 14 — Markets for Factors of Production ==================== */
    { id: "ch14_derived_demand", chapter: 14, kind: "mc", render: "text", difficulty: "hard", concept: "derived demand", points: 3,
      prompt: "The demand for labor is called a 'derived demand' because it:",
      options: ["is derived from the demand for the goods that labor produces",
        "is derived from workers' preferences", "comes from the government",
        "depends only on the wage"], answer: 0,
      rationale: "Firms hire workers to produce output, so labor demand depends on \u2014 is derived from \u2014 how much consumers want the final product." },
    { id: "ch14_vmpl", chapter: 14, kind: "mc", render: "text", difficulty: "hard", concept: "value of marginal product", points: 3,
      prompt: "A competitive, profit-maximizing firm hires labor up to the point where:",
      options: ["the value of the marginal product of labor equals the wage",
        "the marginal product of labor is zero", "total product is maximized",
        "the wage equals the price of output"], answer: 0,
      rationale: "The firm hires until VMPL (price \u00d7 marginal product of labor) equals the wage \u2014 the last worker's contribution to revenue just covers their pay." },
    { id: "ch14_vmpl_calc", chapter: 14, kind: "numeric", render: "text", difficulty: "hard", concept: "VMPL computation", points: 2,
      prompt: "A worker's marginal product is 8 units per hour, and each unit sells for $5 in a competitive market. What is the value of the marginal product of that worker (per hour)?",
      answer: 40, tolerance: 0.01,
      rationale: "VMPL = price \u00d7 marginal product = $5 \u00d7 8 = $40. The firm would hire this worker as long as the wage is at or below $40." },
    { id: "ch14_labor_demand_shift", chapter: 14, kind: "mc", render: "text", difficulty: "hard", concept: "shifts in labor demand", points: 3,
      prompt: "Which change would shift the DEMAND for labor to the RIGHT?",
      options: ["a rise in the price of the output the workers produce",
        "an increase in the wage", "a fall in the demand for the final product",
        "an increase in the number of workers available"], answer: 0,
      rationale: "A higher output price raises the value of each worker's marginal product (VMPL), increasing labor demand. A wage change is a movement along the curve; more workers shifts supply, not demand." },
    { id: "ch14_labor_supply", chapter: 14, kind: "mc", render: "text", difficulty: "med", concept: "labor supply", points: 1,
      prompt: "The labor-supply curve generally slopes upward because:",
      options: ["a higher wage raises the opportunity cost of leisure, encouraging people to work more",
        "people work less when paid more", "wages don't affect work decisions",
        "leisure has no value"], answer: 0,
      rationale: "A higher wage makes each hour of leisure more costly (in forgone pay), so on balance people supply more labor \u2014 an upward-sloping supply curve." },
    { id: "ch14_marginal_product_labor", chapter: 14, kind: "mc", render: "text", difficulty: "hard", concept: "diminishing marginal product and labor demand", points: 3,
      prompt: "The labor-demand (VMPL) curve slopes downward primarily because:",
      options: ["the marginal product of labor diminishes as more workers are added",
        "output prices always fall", "wages always rise", "workers become lazier"], answer: 0,
      rationale: "With other inputs fixed, adding workers eventually lowers each additional worker's marginal product (diminishing returns), so VMPL \u2014 and thus labor demand \u2014 declines." },
    { id: "ch14_complementary_inputs", chapter: 14, kind: "mc", render: "text", difficulty: "hard", concept: "capital and labor", points: 3,
      prompt: "If a firm gives its workers better equipment (more capital), the demand for labor will most likely:",
      options: ["increase, because more capital raises the marginal product of labor",
        "decrease to zero", "be unaffected", "become perfectly inelastic"], answer: 0,
      rationale: "Capital and labor are often complements: better tools raise workers' marginal product, increasing their VMPL and the firm's demand for labor (and their wages)." },
    { id: "ch14_wage_determination", chapter: 14, kind: "mc", render: "text", difficulty: "med", concept: "equilibrium wage", points: 1,
      prompt: "In a competitive labor market, the equilibrium wage is determined by:",
      options: ["the supply of and demand for labor", "the government alone",
        "only the firm's preferences", "the price of capital only"], answer: 0,
      rationale: "Like any competitive market, the wage adjusts to equate the quantity of labor supplied and demanded." },
    { id: "ch14_other_factors", chapter: 14, kind: "mc", render: "text", difficulty: "med", concept: "land and capital returns", points: 1,
      prompt: "In competitive factor markets, the price paid for the use of land or capital equals:",
      options: ["the value of that factor's marginal product",
        "zero", "the wage of labor", "the government-set rate"], answer: 0,
      rationale: "The same marginal-productivity logic applies to all factors: each is paid the value of its marginal product in equilibrium." },
    { id: "ch14_factor_linkage", chapter: 14, kind: "mc", render: "text", difficulty: "hard", concept: "linkage among factor prices", points: 3,
      prompt: "An event that reduces the supply of one factor (say, a decline in the number of workers) will tend to:",
      options: ["raise the wage of remaining workers but can lower the return to complementary capital",
        "raise all factor prices equally", "have no effect on any factor",
        "lower the wage of workers"], answer: 0,
      rationale: "Factors are interdependent: fewer workers raises their wage, but with less labor to work with, complementary capital may become less productive, lowering its return." },
    { id: "ch14_monopsony", chapter: 14, kind: "mc", render: "text", difficulty: "hard", concept: "monopsony", points: 3,
      prompt: "A 'monopsony' in a labor market is a situation where:",
      options: ["there is a single dominant buyer of labor, giving the employer wage-setting power",
        "there are many employers", "workers set their own wages",
        "the government employs everyone"], answer: 0,
      rationale: "A monopsony is a market with one main buyer (employer). Like a monopoly in reverse, it can push the wage below the competitive level by hiring fewer workers." },
    { id: "ch14_human_capital", chapter: 14, kind: "mc", render: "text", difficulty: "med", concept: "human capital and wages", points: 1,
      prompt: "One reason more-educated workers tend to earn higher wages is that:",
      options: ["education raises their productivity (human capital), increasing their VMPL",
        "education has no effect on productivity", "firms are required to pay them more",
        "educated workers supply less labor"], answer: 0,
      rationale: "Human capital \u2014 skills and knowledge from education and training \u2014 raises a worker's marginal product and thus the value employers place on their labor." },
    { id: "ch14_written_labor_demand", chapter: 14, kind: "short", render: "text", difficulty: "hard", concept: "labor demand analysis", points: 3,
      prompt: "Explain why the demand for labor is a 'derived demand' and why a competitive firm hires workers up to the point where the value of the marginal product of labor equals the wage. What happens if VMPL exceeds the wage?",
      answer: null,
      rubric: "Full credit: (1) labor demand is derived from demand for the output workers make; (2) the firm hires until VMPL = wage because that maximizes profit; (3) if VMPL > wage, the worker adds more to revenue than to cost, so hiring more raises profit; (4) the firm keeps hiring until VMPL falls to the wage (diminishing marginal product). Partial credit per element.",
      rationale: "Looking for derived demand, the VMPL=wage rule, and the profit logic when VMPL exceeds the wage." },
    { id: "ch14_written_wage_gap", chapter: 14, kind: "short", render: "text", difficulty: "hard", concept: "wage differences", points: 3,
      prompt: "Using marginal-productivity theory, give two distinct reasons why one worker might earn a higher wage than another in competitive labor markets.",
      answer: null,
      rubric: "Full credit: any two valid, distinct reasons tied to VMPL, e.g.: (1) higher human capital/skills raise marginal product; (2) working with more/better capital raises marginal product; (3) producing a higher-valued output raises VMPL; (4) compensating differentials for unpleasant/risky jobs; (5) innate ability/effort. Two clearly explained reasons earn full credit. Partial credit for one.",
      rationale: "Looking for two valid VMPL-based reasons for wage differences." },
    { id: "ch14_supply_shift_wage", chapter: 14, kind: "mc", render: "text", difficulty: "hard", concept: "immigration/supply and wages", points: 3,
      prompt: "If a large number of new workers enter a competitive labor market (labor supply shifts right), holding labor demand fixed, the equilibrium wage will:",
      options: ["fall, and the quantity of labor employed will rise",
        "rise, and employment will fall", "stay the same",
        "rise, and employment will rise"], answer: 0,
      rationale: "A rightward shift in labor supply moves down along labor demand: the wage falls and the quantity of labor employed rises." }
    ,
    /* ==================== Chapter 15 — Externalities ==================== */
    { id: "ch15_definition", chapter: 15, kind: "mc", render: "text", difficulty: "easy", concept: "externality definition", points: 1,
      prompt: "An externality is:",
      options: ["an uncompensated cost or benefit that a market activity imposes on a bystander",
        "a tax paid to the government", "a cost paid by the buyer",
        "any cost of production"], answer: 0,
      rationale: "An externality is a side effect on someone not party to the transaction \u2014 e.g., pollution (negative) or a neighbor's flowers (positive)." },
    { id: "ch15_negative_over", chapter: 15, kind: "mc", render: "text", difficulty: "hard", concept: "negative externality overproduction", points: 3,
      prompt: "In a market with a negative externality (like pollution), the free market produces:",
      options: ["more than the socially optimal quantity, because producers ignore the external cost",
        "less than the optimal quantity", "exactly the optimal quantity",
        "nothing at all"], answer: 0,
      rationale: "Producers weigh only their private cost, not the external cost borne by others, so the market output exceeds the level that would maximize total (social) surplus." },
    { id: "ch15_positive_under", chapter: 15, kind: "mc", render: "text", difficulty: "hard", concept: "positive externality underproduction", points: 3,
      prompt: "A good with a positive externality (like vaccination or education) is:",
      options: ["underproduced by the free market, because buyers ignore the external benefit",
        "overproduced by the market", "produced at the optimal level",
        "never produced"], answer: 0,
      rationale: "Buyers consider only their private benefit, not the benefit to others, so the market quantity falls short of the socially optimal level." },
    { id: "ch15_pigovian", chapter: 15, kind: "mc", render: "text", difficulty: "med", concept: "Pigovian tax", points: 1,
      prompt: "A tax designed to correct a negative externality is called a:",
      options: ["Pigovian tax, set equal to the external cost per unit",
        "sales tax", "lump-sum tax", "tariff"], answer: 0,
      rationale: "A Pigovian tax equal to the external cost makes producers internalize the externality, moving output toward the social optimum." },
    { id: "ch15_subsidy_positive", chapter: 15, kind: "mc", render: "text", difficulty: "hard", concept: "correcting positive externality", points: 3,
      prompt: "To correct a positive externality, the government could:",
      options: ["subsidize the activity so more of it is produced/consumed",
        "tax the activity to reduce it", "ban the activity",
        "do nothing \u2014 markets handle positive externalities efficiently"], answer: 0,
      rationale: "A subsidy equal to the external benefit encourages the additional production/consumption that raises total surplus (e.g., education subsidies)." },
    { id: "ch15_coase", chapter: 15, kind: "mc", render: "text", difficulty: "hard", concept: "Coase theorem", points: 3,
      prompt: "The Coase theorem states that if private parties can bargain costlessly over an externality, they:",
      options: ["can reach the efficient outcome on their own, regardless of the initial assignment of rights",
        "always need government intervention", "will never reach agreement",
        "will always produce too much pollution"], answer: 0,
      rationale: "Coase argued that with well-defined property rights and no transaction costs, private bargaining internalizes the externality and reaches efficiency \u2014 who holds the right affects the distribution, not the efficient quantity." },
    { id: "ch15_coase_fails", chapter: 15, kind: "mc", render: "text", difficulty: "hard", concept: "why Coase bargaining fails", points: 3,
      prompt: "Private bargaining often FAILS to solve externalities in practice because of:",
      options: ["transaction costs \u2014 too many parties, holdouts, or costly negotiation",
        "the absence of any externality", "government intervention",
        "the fact that bargaining is always illegal"], answer: 0,
      rationale: "When many parties are involved (e.g., air pollution affecting millions), the costs of organizing and enforcing an agreement are prohibitive, so private bargaining breaks down and policy is needed." },
    { id: "ch15_tradable_permits", chapter: 15, kind: "mc", render: "text", difficulty: "hard", concept: "cap and trade", points: 3,
      prompt: "A key advantage of tradable pollution permits (cap-and-trade) over a uniform quantity limit is that permits:",
      options: ["let reductions happen where they are cheapest, since firms that can cut cheaply sell permits to those who can't",
        "allow unlimited pollution", "require every firm to cut by the same amount",
        "eliminate the need to set any cap"], answer: 0,
      rationale: "Tradable permits achieve a given pollution target at least cost: firms with low abatement costs cut more and sell permits to firms with high abatement costs \u2014 an efficient allocation of the cleanup." },
    { id: "ch15_tax_vs_permits", chapter: 15, kind: "mc", render: "text", difficulty: "hard", concept: "corrective tax vs permits", points: 3,
      prompt: "A corrective tax and a system of tradable permits are similar in that both:",
      options: ["put a price on pollution, giving firms an incentive to reduce it efficiently",
        "set the quantity of pollution with certainty", "ban pollution outright",
        "ignore the cost of abatement"], answer: 0,
      rationale: "Both are market-based: a tax sets the price of pollution directly; permits set the quantity and let the market determine the price. Both let firms choose the cheapest way to meet the goal." },
    { id: "ch15_command_control", chapter: 15, kind: "mc", render: "text", difficulty: "hard", concept: "regulation vs market-based", points: 3,
      prompt: "Compared with command-and-control regulation (e.g., 'every firm must install scrubber X'), economists often prefer market-based tools because they:",
      options: ["achieve pollution reduction at lower total cost by letting firms find the cheapest abatement",
        "always allow more pollution", "are easier to write into law",
        "guarantee identical behavior by every firm"], answer: 0,
      rationale: "Market-based policies harness firms' own cost information, concentrating cleanup where it's cheapest \u2014 generally reaching a target more cheaply than uniform mandates." },
    { id: "ch15_internalize", chapter: 15, kind: "mc", render: "text", difficulty: "med", concept: "internalizing the externality", points: 1,
      prompt: "To 'internalize an externality' means to:",
      options: ["alter incentives so people account for the external effects of their actions",
        "ignore the externality", "move production indoors",
        "eliminate all production"], answer: 0,
      rationale: "Internalizing means making decision-makers face the true social cost or benefit \u2014 via taxes, subsidies, permits, or property rights \u2014 so private incentives align with social welfare." },
    { id: "ch15_private_solutions", chapter: 15, kind: "mc", render: "text", difficulty: "med", concept: "private solutions", points: 1,
      prompt: "Which is a PRIVATE (non-governmental) solution to an externality?",
      options: ["moral codes, charities, or contracts between the affected parties",
        "a Pigovian tax", "tradable permits issued by the state",
        "command-and-control regulation"], answer: 0,
      rationale: "Private solutions include social norms, charities, integrating businesses, and Coasean bargaining/contracts \u2014 all working without direct government action." },
    { id: "ch15_written_pollution", chapter: 15, kind: "short", render: "text", difficulty: "hard", concept: "negative externality policy", points: 3,
      prompt: "A factory emits pollution that harms a nearby community. Explain why the free-market quantity is inefficient, and compare a Pigovian tax with a command-and-control emission limit as ways to fix it. Which do many economists prefer, and why?",
      answer: null,
      rubric: "Full credit: (1) the firm ignores external cost, so social cost > private cost and the market overproduces (deadweight loss); (2) a Pigovian tax equal to the external cost internalizes it, reaching the optimum and letting firms choose how to abate; (3) command-and-control mandates specific actions; (4) economists often prefer the tax (or permits) because it achieves the target at lower cost by using firms' abatement-cost information. Partial credit per element.",
      rationale: "Looking for the overproduction argument plus the tax-vs-mandate comparison and the cost-efficiency preference." },
    { id: "ch15_written_coase", chapter: 15, kind: "short", render: "text", difficulty: "hard", concept: "Coase theorem application", points: 3,
      prompt: "A dog owner's barking dog disturbs one neighbor. Explain how, according to the Coase theorem, the two might reach an efficient outcome through private bargaining, and why the same logic often fails for a problem like city-wide air pollution.",
      answer: null,
      rubric: "Full credit: (1) with clear property rights and low bargaining costs, the neighbors can negotiate a payment (either direction) that reaches the efficient outcome; (2) the efficient result holds regardless of who has the initial right (rights affect distribution, not efficiency); (3) air pollution involves millions of parties \u2192 high transaction costs, free-riding, holdouts; (4) so private bargaining breaks down and government policy is needed. Partial credit per element.",
      rationale: "Looking for the costless-bargaining efficiency result and why transaction costs defeat it at scale." },
    { id: "ch15_optimal_not_zero", chapter: 15, kind: "mc", render: "text", difficulty: "hard", concept: "optimal pollution is not zero", points: 3,
      prompt: "Most economists argue the socially optimal level of pollution is NOT zero because:",
      options: ["eliminating all pollution would require giving up too many valuable goods \u2014 the optimum balances marginal benefit and marginal cost of abatement",
        "pollution is always harmless", "zero pollution is physically impossible only",
        "firms should never be regulated"], answer: 0,
      rationale: "Reducing pollution has rising marginal costs (lost output); the optimum is where the marginal benefit of further cleanup equals its marginal cost \u2014 usually a positive, not zero, level of pollution." }
    ,
    /* ==================== Chapter 16 — Asymmetric Information / Info Economics ==================== */
    { id: "ch16_asym_info", chapter: 16, kind: "mc", render: "text", difficulty: "easy", concept: "asymmetric information", points: 1,
      prompt: "Asymmetric information refers to a situation where:",
      options: ["one party in a transaction knows more relevant information than the other",
        "both parties know everything", "neither party has any information",
        "information is free to all"], answer: 0,
      rationale: "Asymmetric information means one side (e.g., a used-car seller or an insurance buyer) has private knowledge the other lacks, which can distort markets." },
    { id: "ch16_adverse_selection", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "adverse selection", points: 3,
      prompt: "Adverse selection is a problem that arises BEFORE a transaction, when:",
      options: ["the informed party's hidden characteristics make the mix of goods/people in the market worse (e.g., mostly low-quality used cars)",
        "one party changes behavior after the deal", "both parties are fully informed",
        "prices are set by the government"], answer: 0,
      rationale: "Adverse selection: hidden pre-existing traits (a car's true condition, a person's health risk) cause high-quality goods or low-risk people to exit, leaving a worse-than-average pool." },
    { id: "ch16_lemons", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "market for lemons", points: 3,
      prompt: "In Akerlof's 'market for lemons,' used-car buyers can't tell good cars from bad ones. The result is that:",
      options: ["buyers offer only an average price, good-car owners withdraw, and the market fills with lemons",
        "only high-quality cars are sold", "prices rise to reflect quality",
        "the market works perfectly"], answer: 0,
      rationale: "Because buyers pay only an average price, owners of good cars won't sell, worsening the average quality \u2014 a downward spiral driven by adverse selection." },
    { id: "ch16_moral_hazard", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "moral hazard", points: 3,
      prompt: "Moral hazard is a problem that arises AFTER a transaction, when:",
      options: ["one party changes behavior (takes more risk or less care) because they no longer bear the full consequences",
        "hidden characteristics distort the market beforehand", "both parties are honest",
        "there is no insurance"], answer: 0,
      rationale: "Moral hazard: once insured or unmonitored, a party has weaker incentives to be careful (e.g., an insured driver drives less cautiously) because they don't bear the full cost of their actions." },
    { id: "ch16_signaling", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "signaling", points: 3,
      prompt: "'Signaling' addresses asymmetric information when:",
      options: ["the informed party takes a costly action to credibly reveal its private information (e.g., a warranty signals quality)",
        "the uninformed party gathers information", "the government sets prices",
        "both parties stay ignorant"], answer: 0,
      rationale: "Signaling: the party WITH information takes an action that's only worthwhile if their claim is true \u2014 e.g., a firm offering a long warranty, or a worker earning a degree \u2014 credibly conveying quality." },
    { id: "ch16_screening", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "screening", points: 3,
      prompt: "'Screening' differs from signaling in that:",
      options: ["the UNINFORMED party takes an action to induce the informed party to reveal information (e.g., insurers offering different deductible options)",
        "the informed party reveals information", "no information is ever revealed",
        "it only applies to labor markets"], answer: 0,
      rationale: "Screening is done by the uninformed side \u2014 e.g., an insurer offering a menu of policies so that high- and low-risk customers self-select into different plans, revealing their type." },
    { id: "ch16_education_signal", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "education as a signal", points: 3,
      prompt: "The 'signaling' theory of education argues that a college degree can raise wages even if college teaches no useful skills, because:",
      options: ["completing a degree signals pre-existing ability/persistence that employers value",
        "education always adds human capital", "degrees are randomly assigned",
        "employers ignore education"], answer: 0,
      rationale: "In the pure signaling view, the degree is valuable as a credible signal of underlying traits (ability, work ethic) that only capable people can attain \u2014 separate from the human-capital (skill-building) view." },
    { id: "ch16_warranty_signal", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "warranties as signals", points: 3,
      prompt: "A generous warranty can serve as a credible quality signal because:",
      options: ["it is cheap to offer for a high-quality product but expensive for a low-quality one",
        "all firms can offer it equally cheaply", "it conveys no information",
        "customers ignore warranties"], answer: 0,
      rationale: "A signal is credible only if it's costlier for low-quality types. A firm confident in its product expects few claims, so a strong warranty costs it little \u2014 low-quality firms can't profitably imitate it." },
    { id: "ch16_insurance_adverse", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "adverse selection in insurance", points: 3,
      prompt: "Adverse selection in health insurance means that, at a given premium:",
      options: ["sicker (higher-risk) people are more likely to buy, raising insurers' costs and premiums",
        "only healthy people buy insurance", "risk has no effect on who buys",
        "premiums always fall over time"], answer: 0,
      rationale: "Those who know they're high-risk value insurance most, so they disproportionately enroll. This raises average claims and premiums, which can drive out low-risk buyers \u2014 a selection spiral." },
    { id: "ch16_deductible", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "deductibles and moral hazard", points: 3,
      prompt: "Insurance deductibles and co-pays help reduce moral hazard by:",
      options: ["making the insured bear part of the cost, restoring some incentive for care",
        "eliminating all risk for the insured", "increasing claims",
        "removing the insured's incentive to be careful"], answer: 0,
      rationale: "By leaving the insured responsible for part of any loss, deductibles/co-pays restore some 'skin in the game,' curbing the careless behavior that full coverage would encourage." },
    { id: "ch16_efficiency_wages", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "efficiency wages / moral hazard in labor", points: 3,
      prompt: "Paying 'efficiency wages' (above the market wage) can reduce the moral-hazard problem of workers shirking because:",
      options: ["a higher wage makes the job more valuable to keep, so workers exert more effort to avoid being fired",
        "it lowers the firm's costs", "it guarantees workers never quit",
        "it has no effect on effort"], answer: 0,
      rationale: "Above-market pay raises the cost of job loss, giving workers an incentive to work hard rather than risk being caught shirking and dismissed \u2014 addressing the hidden-action (moral hazard) problem." },
    { id: "ch16_written_asym", chapter: 16, kind: "short", render: "text", difficulty: "hard", concept: "adverse selection vs moral hazard", points: 3,
      prompt: "Distinguish adverse selection from moral hazard, giving one example of each from insurance markets. For each, name one mechanism that helps reduce the problem.",
      answer: null,
      rubric: "Full credit: (1) adverse selection = hidden characteristics BEFORE the deal (e.g., high-risk people buying more insurance); mechanism: screening/risk classification, mandates; (2) moral hazard = hidden actions AFTER the deal (e.g., insured taking more risk); mechanism: deductibles/co-pays/monitoring; (3) clear example for each; (4) a valid remedy for each. Partial credit per element.",
      rationale: "Looking for the before/after distinction, correct examples, and a remedy for each." },
    { id: "ch16_written_signaling", chapter: 16, kind: "short", render: "text", difficulty: "hard", concept: "signaling analysis", points: 3,
      prompt: "Explain what makes an action a CREDIBLE signal in a market with asymmetric information. Then evaluate whether a job applicant's expensive college degree is best understood as human capital, a signal, or both.",
      answer: null,
      rubric: "Full credit: (1) a credible signal must be costlier (or only feasible) for the low-quality type, so imitation isn't worthwhile; (2) human-capital view: college builds productive skills; (3) signaling view: the degree reveals pre-existing ability/persistence; (4) a reasonable conclusion that it is likely both, with justification. Partial credit per element.",
      rationale: "Looking for the differential-cost credibility condition and a reasoned human-capital vs signaling evaluation." }
    ,
    /* ==================== Chapter 17 — Behavioral Economics ==================== */
    { id: "ch17_definition", chapter: 17, kind: "mc", render: "text", difficulty: "easy", concept: "behavioral economics", points: 1,
      prompt: "Behavioral economics studies:",
      options: ["how real people actually make decisions, often departing from perfect rationality",
        "only perfectly rational agents", "the behavior of firms only",
        "how animals respond to prices"], answer: 0,
      rationale: "Behavioral economics incorporates insights from psychology to explain systematic ways people deviate from the fully rational 'homo economicus' model." },
    { id: "ch17_bounded_rationality", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "bounded rationality", points: 3,
      prompt: "'Bounded rationality' means that people:",
      options: ["try to make good decisions but are limited by cognitive capacity, information, and time, so they use rules of thumb",
        "are always perfectly rational", "never make good decisions",
        "ignore all information"], answer: 0,
      rationale: "Bounded rationality: people are intendedly rational but constrained, so they rely on heuristics (mental shortcuts) rather than solving every problem optimally." },
    { id: "ch17_overconfidence", chapter: 17, kind: "mc", render: "text", difficulty: "med", concept: "overconfidence", points: 1,
      prompt: "Evidence that most drivers rate themselves 'above average' illustrates the bias of:",
      options: ["overconfidence", "loss aversion", "anchoring", "hyperbolic discounting"], answer: 0,
      rationale: "Overconfidence is the systematic tendency to overestimate one's own abilities or the precision of one's knowledge." },
    { id: "ch17_loss_aversion", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "loss aversion", points: 3,
      prompt: "Loss aversion describes the finding that people:",
      options: ["feel the pain of a loss more strongly than the pleasure of an equal-sized gain",
        "value gains and losses equally", "always prefer risk",
        "ignore losses entirely"], answer: 0,
      rationale: "Loss aversion: a $100 loss hurts more than a $100 gain feels good. It helps explain the endowment effect and reluctance to sell at a loss." },
    { id: "ch17_endowment", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "endowment effect", points: 3,
      prompt: "The 'endowment effect' is the tendency to:",
      options: ["value a good more highly simply because one owns it",
        "value goods one doesn't own more", "ignore ownership when valuing goods",
        "always undervalue what one owns"], answer: 0,
      rationale: "People often demand much more to give up an item than they'd have paid to acquire it \u2014 a consequence of loss aversion applied to things one already possesses." },
    { id: "ch17_anchoring", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "anchoring", points: 3,
      prompt: "'Anchoring' occurs when:",
      options: ["an initial number (even an irrelevant one) influences subsequent judgments or valuations",
        "people ignore all reference points", "decisions are perfectly rational",
        "prices never affect willingness to pay"], answer: 0,
      rationale: "Anchoring: an arbitrary starting figure (like a suggested price) pulls estimates toward it, biasing negotiations and valuations." },
    { id: "ch17_framing", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "framing effects", points: 3,
      prompt: "A 'framing effect' means that people's choices can change when:",
      options: ["the same options are described differently (e.g., '90% survival' vs '10% mortality')",
        "the options are genuinely different", "prices change", "income changes"], answer: 0,
      rationale: "Framing: logically equivalent descriptions produce different choices because presentation affects perception \u2014 a departure from the rationality assumption that framing shouldn't matter." },
    { id: "ch17_time_inconsistency", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "time inconsistency / present bias", points: 3,
      prompt: "A person who plans to start dieting 'tomorrow' but never does is exhibiting:",
      options: ["time inconsistency (present bias) \u2014 overweighting immediate costs and benefits",
        "perfect self-control", "loss aversion", "the endowment effect"], answer: 0,
      rationale: "Present-biased (hyperbolic) preferences make people place disproportionate weight on the present, so plans made for the future are reversed when 'the future' arrives." },
    { id: "ch17_sunk_cost_fallacy", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "sunk cost fallacy", points: 3,
      prompt: "Continuing a failing project because 'we've already invested so much' is the:",
      options: ["sunk-cost fallacy \u2014 letting unrecoverable past costs drive forward-looking decisions",
        "rational response to marginal analysis", "endowment effect", "anchoring bias"], answer: 0,
      rationale: "Rational decisions ignore sunk (unrecoverable) costs and weigh only future costs and benefits. The fallacy is letting past investment justify throwing good money after bad." },
    { id: "ch17_ultimatum", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "fairness / ultimatum game", points: 3,
      prompt: "In ultimatum-game experiments, responders often reject small but positive offers. This suggests that people:",
      options: ["care about fairness, not just their own monetary payoff",
        "are purely self-interested", "never reject any offer",
        "always accept the smallest offer"], answer: 0,
      rationale: "A purely self-interested responder would accept any positive amount. Frequent rejection of 'unfair' low offers shows that fairness and reciprocity enter people's preferences." },
    { id: "ch17_nudge", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "nudges and defaults", points: 3,
      prompt: "Automatically enrolling employees in a retirement plan (while letting them opt out) dramatically raises participation. This works because of:",
      options: ["default bias / status-quo bias \u2014 people tend to stick with the default option",
        "loss aversion only", "perfect rationality", "anchoring on wages"], answer: 0,
      rationale: "People disproportionately stick with defaults (inertia/status-quo bias), so setting a beneficial default ('nudge') strongly influences behavior without restricting choice." },
    { id: "ch17_mental_accounting", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "mental accounting", points: 3,
      prompt: "Treating a $500 tax refund as 'fun money' to splurge, while carefully budgeting regular salary, is an example of:",
      options: ["mental accounting \u2014 treating money differently depending on its source or label",
        "rational fungibility of money", "loss aversion", "anchoring"], answer: 0,
      rationale: "Money is fungible, so rationally its source shouldn't matter. Mental accounting is the tendency to put money in separate 'accounts' and treat them by different rules." },
    { id: "ch17_written_biases", chapter: 17, kind: "short", render: "text", difficulty: "hard", concept: "behavioral biases application", points: 3,
      prompt: "Choose TWO behavioral concepts (e.g., loss aversion, present bias, anchoring, framing, sunk-cost fallacy). Define each and give a concrete real-world example showing how it leads people to depart from the standard rational-choice prediction.",
      answer: null,
      rubric: "Full credit: for EACH of two concepts \u2014 (a) a correct definition and (b) a concrete, valid example showing the departure from rationality. Two concepts fully handled = full credit; one concept = partial.",
      rationale: "Looking for correct definitions and valid, concrete examples for two distinct behavioral concepts." },
    { id: "ch17_written_nudge", chapter: 17, kind: "short", render: "text", difficulty: "hard", concept: "nudges and policy", points: 3,
      prompt: "Explain what a 'nudge' is and why default options are so powerful. Then give one argument in favor of using nudges in policy and one concern critics raise about them.",
      answer: null,
      rubric: "Full credit: (1) a nudge alters the choice architecture to influence decisions without removing options or changing incentives much; (2) defaults are powerful due to status-quo bias/inertia; (3) a pro (helps people overcome biases, cheap, preserves freedom of choice); (4) a con (paternalism, who decides what's 'good,' manipulation concerns). Partial credit per element.",
      rationale: "Looking for the definition, the status-quo-bias mechanism, and a balanced pro/con on nudge policy." }
    ,
    /* ==================== TOP-UP BATCH (Ch12-17) ==================== */

    /* --- Ch12 (need 5) --- */
    { id: "ch12_nonprice_comp", chapter: 12, kind: "mc", render: "text", difficulty: "med", concept: "non-price competition", points: 1,
      prompt: "Monopolistically competitive firms compete heavily through:",
      options: ["product differentiation and advertising (non-price competition)",
        "identical pricing only", "producing identical goods", "cutting output to zero"], answer: 0,
      rationale: "Because products are differentiated, firms compete on features, quality, branding, and advertising \u2014 not just price." },
    { id: "ch12_number_products", chapter: 12, kind: "mc", render: "text", difficulty: "hard", concept: "socially optimal variety", points: 3,
      prompt: "Whether a monopolistically competitive market provides too many or too few products is ambiguous because entry creates:",
      options: ["a positive variety externality and a negative business-stealing externality that work in opposite directions",
        "only benefits", "only costs", "no externalities at all"], answer: 0,
      rationale: "Entry adds valuable variety (positive) but steals business from incumbents (negative). Since these pull opposite ways, economists can't say in general whether there's too much or too little entry." },
    { id: "ch12_vs_monopoly", chapter: 12, kind: "mc", render: "text", difficulty: "hard", concept: "mon. comp. vs monopoly", points: 3,
      prompt: "A monopolistically competitive firm differs from a monopoly mainly because:",
      options: ["free entry drives its long-run economic profit to zero",
        "it faces an upward-sloping demand curve", "it is a price taker",
        "it never advertises"], answer: 0,
      rationale: "Both face downward-sloping demand and set MR=MC, but free entry in monopolistic competition competes away long-run profit \u2014 a monopoly (protected by barriers) can keep earning it." },
    { id: "ch12_markup_reason", chapter: 12, kind: "mc", render: "text", difficulty: "hard", concept: "why firms welcome customers", points: 3,
      prompt: "Because price exceeds marginal cost, a monopolistically competitive firm:",
      options: ["is happy to gain an extra customer at the going price \u2014 hence advertising and promotions",
        "loses money on each extra sale", "wants fewer customers",
        "sets price equal to marginal cost"], answer: 0,
      rationale: "With P > MC, each additional sale adds more to revenue than to cost, so firms actively seek more customers through advertising and promotions." },
    { id: "ch12_written_efficiency", chapter: 12, kind: "short", render: "text", difficulty: "hard", concept: "welfare of monopolistic competition", points: 3,
      prompt: "Is monopolistic competition socially wasteful? Present the case that it is inefficient AND the offsetting benefit it provides. Conclude with a balanced judgment.",
      answer: null,
      rubric: "Full credit: (1) inefficiency: P > MC (markup, lost trades) and excess capacity (above min ATC); (2) offsetting benefit: product variety consumers value; (3) the business-stealing vs variety externalities make net welfare ambiguous; (4) a balanced conclusion. Partial credit per element.",
      rationale: "Looking for the P>MC/excess-capacity inefficiency, the variety benefit, and a balanced conclusion." },

    /* --- Ch13 (need 9): payoff-matrix numeric + application --- */
    { id: "ch13_pd_payoff", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "reading a payoff matrix", points: 3,
      prompt: "Two firms choose High or Low output. Profits (Firm A, Firm B): both Low = (50, 50); both High = (30, 30); A High/B Low = (60, 20); A Low/B High = (20, 60). What is the Nash equilibrium?",
      options: ["Both choose High (30, 30)", "Both choose Low (50, 50)",
        "A High, B Low (60, 20)", "There is no Nash equilibrium"], answer: 0,
      rationale: "High is a dominant strategy for each (60>50 if rival Low; 30>20 if rival High). So both play High \u2192 (30,30), a Nash equilibrium that is worse for both than mutual Low (50,50)." },
    { id: "ch13_pd_cooperative", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "cooperative outcome", points: 3,
      prompt: "In that same game (both Low = 50 each; both High = 30 each), the OUTCOME THAT MAXIMIZES JOINT PROFIT is:",
      options: ["both choose Low (total 100) \u2014 but it isn't a Nash equilibrium",
        "both choose High (total 60)", "one High, one Low (total 80)",
        "there is no way to maximize joint profit"], answer: 0,
      rationale: "Joint profit is highest when both cooperate at Low (50+50=100). But since each is individually tempted to defect to High, this cooperative outcome isn't self-enforcing in a one-shot game." },
    { id: "ch13_dominant_check", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "identifying dominant strategy", points: 3,
      prompt: "A firm earns more by advertising than not advertising REGARDLESS of what its rival does. For this firm, advertising is:",
      options: ["a dominant strategy", "a dominated strategy",
        "irrelevant", "only optimal if the rival advertises"], answer: 0,
      rationale: "A strategy that yields a higher payoff no matter what the opponent does is a dominant strategy \u2014 here, advertising." },
    { id: "ch13_oligopoly_price", chapter: 13, kind: "mc", render: "text", difficulty: "med", concept: "oligopoly price range", points: 2,
      prompt: "Compared with monopoly and perfect competition, the price in an oligopoly typically lies:",
      options: ["between the monopoly price and the competitive price",
        "above the monopoly price", "below the competitive price",
        "exactly at the competitive price always"], answer: 0,
      rationale: "Oligopolists produce more than a monopoly (each ignores the price effect on rivals' output) but less than perfect competition, so price falls in between." },
    { id: "ch13_kinked", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "price rigidity", points: 3,
      prompt: "Oligopoly prices are sometimes 'sticky' (change infrequently) partly because firms fear that:",
      options: ["if they cut price, rivals will match it (starting a price war), but if they raise it, rivals won't follow",
        "customers never respond to prices", "costs never change",
        "the government forbids price changes"], answer: 0,
      rationale: "The classic intuition: rivals match price cuts (so cutting gains little and risks a war) but not price increases (so raising loses customers) \u2014 discouraging changes in either direction." },
    { id: "ch13_collusion_detect", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "sustaining collusion", points: 3,
      prompt: "Collusion is EASIER to sustain when:",
      options: ["there are few firms, stable demand, and cheating is easy to detect",
        "there are many firms and volatile demand", "cheating is hard to detect",
        "products are highly differentiated and secret"], answer: 0,
      rationale: "Few firms, transparent prices, and easy detection of cheating make punishment credible and collusion stable; many firms, secrecy, and volatility make it collapse." },
    { id: "ch13_game_advertise", chapter: 13, kind: "mc", render: "text", difficulty: "hard", concept: "advertising dilemma", points: 3,
      prompt: "Two cigarette firms would BOTH be better off not advertising, yet both advertise heavily. This is because:",
      options: ["advertising is each firm's dominant strategy, producing a prisoners'-dilemma outcome worse for both",
        "advertising is banned", "neither firm benefits from advertising",
        "they have successfully colluded"], answer: 0,
      rationale: "If each firm gains customers by advertising regardless of the rival's choice, advertising is dominant \u2014 both do it, spending heavily and ending up with the same market shares but lower profits (a dilemma)." },
    { id: "ch13_written_oligopoly_output", chapter: 13, kind: "short", render: "text", difficulty: "hard", concept: "why oligopoly output is between", points: 3,
      prompt: "Explain why total output in an oligopoly is generally greater than a monopoly's but less than a competitive market's. Use the 'output effect' and 'price effect' in your answer.",
      answer: null,
      rubric: "Full credit: (1) each firm weighs the output effect (extra units sold at the price) vs the price effect (lower price on its own units); (2) an oligopolist bears the price effect only on its OWN output, not rivals', so it's more willing to expand than a monopoly \u2192 more output; (3) but each still restricts somewhat (unlike price-taking competitors) \u2192 less than competition; (4) so oligopoly output/price lies between. Partial credit per element.",
      rationale: "Looking for the output vs price effect logic and why partial internalization puts oligopoly between monopoly and competition." },
    { id: "ch13_number_and_price", chapter: 13, kind: "mc", render: "text", difficulty: "med", concept: "entry and oligopoly price", points: 2,
      prompt: "As more firms enter an oligopolistic market, the equilibrium price tends to:",
      options: ["fall toward marginal cost", "rise toward the monopoly price",
        "stay exactly at the monopoly level", "become undefined"], answer: 0,
      rationale: "More firms means each gives less weight to the price effect, expanding output and pushing price down toward marginal cost \u2014 approaching the competitive outcome." },

    /* --- Ch14 (need 6) --- */
    { id: "ch14_compensating_diff", chapter: 14, kind: "mc", render: "text", difficulty: "hard", concept: "compensating differentials", points: 3,
      prompt: "Dangerous or unpleasant jobs often pay more than safe, pleasant jobs requiring similar skill. Economists call this a:",
      options: ["compensating differential", "human-capital premium",
        "monopsony wage", "minimum wage effect"], answer: 0,
      rationale: "A compensating differential is the extra pay that offsets the nonmonetary disadvantages (risk, discomfort) of a job, so workers are willing to take it." },
    { id: "ch14_union", chapter: 14, kind: "mc", render: "text", difficulty: "hard", concept: "unions and wages", points: 3,
      prompt: "By bargaining collectively, a union that raises wages above the competitive level typically causes:",
      options: ["higher wages for employed members but fewer jobs in the unionized sector",
        "higher employment in that sector", "no change in employment",
        "lower wages for members"], answer: 0,
      rationale: "Like a binding wage floor, an above-equilibrium union wage reduces the quantity of labor demanded \u2014 helping those who keep jobs but reducing employment in that sector." },
    { id: "ch14_capital_return", chapter: 14, kind: "mc", render: "text", difficulty: "med", concept: "return to capital", points: 1,
      prompt: "In competitive markets, the rental price of capital tends to equal:",
      options: ["the value of capital's marginal product", "zero",
        "the wage rate", "the price of output"], answer: 0,
      rationale: "The marginal-productivity theory of factor prices applies to capital too: it earns the value of its marginal product in equilibrium." },
    { id: "ch14_superstar", chapter: 14, kind: "mc", render: "text", difficulty: "hard", concept: "superstar phenomenon", points: 3,
      prompt: "Top entertainers and athletes earn enormous incomes partly because:",
      options: ["technology lets the best performer serve a huge market at low marginal cost, so small talent gaps yield large income gaps",
        "they work far more hours than others", "governments set their pay",
        "their marginal product is unmeasurable"], answer: 0,
      rationale: "The 'superstar' effect: when every consumer wants the best and technology (recordings, broadcasts) lets one person supply millions, tiny differences in ability translate into huge differences in earnings." },
    { id: "ch14_discrimination", chapter: 14, kind: "mc", render: "text", difficulty: "hard", concept: "discrimination and markets", points: 3,
      prompt: "Economic theory suggests that in COMPETITIVE markets, employer discrimination that ignores productivity tends to:",
      options: ["be costly to the discriminating firm, since rivals can profit by hiring the productive workers it rejects",
        "always persist without limit", "raise the discriminating firm's profit",
        "have no effect on anyone"], answer: 0,
      rationale: "A firm that passes over productive workers for non-productivity reasons forgoes profit; non-discriminating competitors can hire them cheaply and out-compete it \u2014 so competition tends to erode (though not always eliminate) such discrimination." },
    { id: "ch14_written_superstar", chapter: 14, kind: "short", render: "text", difficulty: "hard", concept: "superstar markets", points: 3,
      prompt: "Explain the two conditions that give rise to 'superstar' labor markets with extreme income inequality, and why an ordinary excellent local plumber does not become a superstar.",
      answer: null,
      rubric: "Full credit: (1) every customer wants the best available product/performer; (2) the good can be produced at low marginal cost so one seller can supply the whole market (recordings/broadcast); (3) a plumber must be physically present, so their market is geographically limited and can't scale; (4) hence no superstar effect for plumbing. Partial credit per element.",
      rationale: "Looking for the two superstar conditions and why non-scalable local services don't qualify." }
    ,
    /* --- Ch15 (need 5) --- */
    { id: "ch15_technology_spillover", chapter: 15, kind: "mc", render: "text", difficulty: "hard", concept: "technology spillover", points: 3,
      prompt: "Research and development often creates a 'technology spillover' \u2014 a positive externality. This implies that, without policy, firms will:",
      options: ["invest less in R&D than is socially optimal", "invest more than optimal",
        "invest the optimal amount", "never invest in R&D"], answer: 0,
      rationale: "Because a firm can't capture all the benefits its innovations confer on others, private R&D falls short of the social optimum \u2014 a rationale for patents and research subsidies." },
    { id: "ch15_double_counting", chapter: 15, kind: "mc", render: "text", difficulty: "hard", concept: "social vs private cost", points: 3,
      prompt: "The 'social cost' curve of a good with a negative externality lies ABOVE the private supply curve by an amount equal to:",
      options: ["the external cost per unit", "the market price",
        "consumer surplus", "the firm's fixed cost"], answer: 0,
      rationale: "Social cost = private cost + external cost. The vertical distance between the social-cost and private-supply curves is exactly the per-unit external cost." },
    { id: "ch15_gas_tax", chapter: 15, kind: "mc", render: "text", difficulty: "hard", concept: "Pigovian tax examples", points: 3,
      prompt: "A gasoline tax is often defended as a corrective (Pigovian) tax because gasoline use causes:",
      options: ["negative externalities like pollution and congestion",
        "positive externalities", "no externalities", "only private costs"], answer: 0,
      rationale: "Driving imposes external costs (pollution, congestion, accident risk) on others; a gas tax makes drivers internalize some of these, and it also raises revenue \u2014 a 'double dividend.'" },
    { id: "ch15_permits_vs_tax_uncertainty", chapter: 15, kind: "mc", render: "text", difficulty: "hard", concept: "tax vs permits under uncertainty", points: 3,
      prompt: "A key difference between a pollution tax and a fixed quantity of tradable permits is that:",
      options: ["a tax fixes the PRICE of pollution while permits fix the QUANTITY of pollution",
        "both fix the price", "both fix the quantity",
        "neither affects pollution"], answer: 0,
      rationale: "A tax sets the price and lets quantity adjust; a permit cap sets the total quantity and lets the permit price adjust. Which is preferable depends on the costs of missing a price vs a quantity target." },
    { id: "ch15_written_optimal_pollution", chapter: 15, kind: "short", render: "text", difficulty: "hard", concept: "optimal level of pollution", points: 3,
      prompt: "Explain why the economically efficient level of pollution is generally not zero. Use the concepts of marginal benefit and marginal cost of pollution reduction.",
      answer: null,
      rubric: "Full credit: (1) reducing pollution has benefits (less harm) but also costs (lost output/abatement expense); (2) the marginal benefit of cleanup falls and marginal cost rises as pollution nears zero; (3) the optimum is where marginal benefit of reduction = marginal cost of reduction; (4) that point is usually a positive level of pollution, since eliminating the last bit costs more than it's worth. Partial credit per element.",
      rationale: "Looking for the MB=MC-of-abatement logic yielding a positive optimal pollution level." },

    /* --- Ch16 (need 12) --- */
    { id: "ch16_hidden_char_action", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "hidden characteristics vs actions", points: 3,
      prompt: "Adverse selection involves hidden ____, while moral hazard involves hidden ____.",
      options: ["characteristics; actions", "actions; characteristics",
        "prices; costs", "costs; prices"], answer: 0,
      rationale: "Adverse selection = hidden characteristics known before the deal; moral hazard = hidden actions taken after the deal." },
    { id: "ch16_used_car_remedy", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "remedies for lemons", points: 3,
      prompt: "Which helps overcome the 'lemons' problem in used cars?",
      options: ["independent inspections, warranties, and dealer reputation",
        "hiding the car's history", "banning used-car sales",
        "charging everyone the average price"], answer: 0,
      rationale: "Mechanisms that credibly reveal quality \u2014 inspections, certified pre-owned warranties, reputations, return policies \u2014 reduce the information gap that drives adverse selection." },
    { id: "ch16_insurance_mandate", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "mandates and adverse selection", points: 3,
      prompt: "Requiring everyone to buy health insurance (an individual mandate) addresses adverse selection by:",
      options: ["bringing low-risk people into the pool, lowering average cost and stabilizing premiums",
        "excluding healthy people", "raising premiums for everyone",
        "eliminating the need for insurers"], answer: 0,
      rationale: "A mandate prevents low-risk individuals from opting out, keeping the risk pool balanced so premiums don't spiral upward as they would if only high-risk people enrolled." },
    { id: "ch16_principal_agent", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "principal-agent problem", points: 3,
      prompt: "The 'principal-agent problem' arises when:",
      options: ["an agent (e.g., an employee) can take hidden actions that don't serve the principal's (employer's) interest",
        "two equally informed parties trade", "there is no delegation of tasks",
        "the government owns all firms"], answer: 0,
      rationale: "When a principal delegates to an agent whose actions can't be perfectly monitored, the agent may pursue their own interest \u2014 a moral-hazard problem addressed by incentives and monitoring." },
    { id: "ch16_stock_options", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "incentive contracts", points: 3,
      prompt: "Paying executives partly in stock or options is intended to reduce the principal-agent problem by:",
      options: ["aligning the manager's payoff with the firm's performance (owners' interest)",
        "guaranteeing a fixed salary", "removing all risk from managers",
        "hiding the firm's performance"], answer: 0,
      rationale: "Tying pay to firm value gives managers a personal stake in outcomes owners care about, mitigating the hidden-action problem \u2014 though it can create new distortions (excessive risk-taking)." },
    { id: "ch16_screening_insurance", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "screening menus", points: 3,
      prompt: "An insurer offers two policies: high-premium/low-deductible and low-premium/high-deductible. This menu SCREENS customers because:",
      options: ["high-risk buyers tend to pick the low-deductible plan, revealing their type through their choice",
        "everyone picks the same plan", "it reveals nothing about risk",
        "it forces buyers to disclose medical records"], answer: 0,
      rationale: "By designing options so that different risk types prefer different plans, the uninformed insurer induces customers to self-select \u2014 screening that reveals hidden risk through choices." },
    { id: "ch16_reputation", chapter: 16, kind: "mc", render: "text", difficulty: "med", concept: "reputation", points: 1,
      prompt: "Online seller ratings and reviews help solve information problems mainly by:",
      options: ["building reputations that give sellers an incentive to maintain quality",
        "hiding seller behavior", "eliminating all bad sellers instantly",
        "setting prices"], answer: 0,
      rationale: "Reputation systems make past behavior visible, so sellers who cheat lose future business \u2014 incentivizing honesty and quality even among strangers." },
    { id: "ch16_political_info", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "rational ignorance", points: 3,
      prompt: "'Rational ignorance' in the context of voting means that a voter:",
      options: ["rationally chooses not to gather costly information because one vote is unlikely to be decisive",
        "is irrational for not voting", "always fully informs themselves",
        "has perfect information"], answer: 0,
      rationale: "Since the cost of becoming informed exceeds the tiny chance of a single vote changing the outcome, staying uninformed can be individually rational \u2014 a challenge for democracy." },
    { id: "ch16_condorcet", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "Condorcet paradox", points: 3,
      prompt: "The Condorcet paradox shows that majority-rule voting over three or more options can:",
      options: ["produce intransitive (cyclic) social preferences even when individuals' preferences are transitive",
        "always yield a clear winner", "never produce a winner",
        "eliminate the need for voting"], answer: 0,
      rationale: "With cyclical group preferences (A beats B, B beats C, C beats A), the outcome can depend on the agenda/order of votes \u2014 majority rule doesn't always yield a consistent social ranking." },
    { id: "ch16_arrow", chapter: 16, kind: "mc", render: "text", difficulty: "hard", concept: "Arrow's impossibility theorem", points: 3,
      prompt: "Arrow's impossibility theorem states that:",
      options: ["no voting system can perfectly aggregate individual preferences into social preferences while satisfying a set of reasonable conditions",
        "majority rule is always fair", "markets always fail",
        "dictatorship is efficient"], answer: 0,
      rationale: "Arrow proved that no rank-order voting rule can simultaneously satisfy a small set of seemingly reasonable fairness criteria (beyond dictatorship) \u2014 a fundamental limit on aggregating preferences." },
    { id: "ch16_written_lemons", chapter: 16, kind: "short", render: "text", difficulty: "hard", concept: "lemons market analysis", points: 3,
      prompt: "Explain the 'market for lemons' and how it can cause a market to unravel. Then describe two mechanisms \u2014 one used by sellers and one by buyers \u2014 that can restore trade.",
      answer: null,
      rubric: "Full credit: (1) buyers can't tell quality, so they pay only an average price; (2) good-quality owners withdraw, lowering average quality, which lowers price further (unraveling); (3) seller mechanism: signaling (warranties, certification, reputation); (4) buyer mechanism: screening (inspections, test drives, history reports). Partial credit per element.",
      rationale: "Looking for the unraveling logic plus one seller-side and one buyer-side remedy." },
    { id: "ch16_written_moral_hazard", chapter: 16, kind: "short", render: "text", difficulty: "hard", concept: "moral hazard remedies", points: 3,
      prompt: "Define moral hazard and give a workplace example. Explain two different ways an employer can reduce it.",
      answer: null,
      rubric: "Full credit: (1) moral hazard = hidden action after an agreement when a party doesn't bear full consequences; (2) a valid workplace example (worker shirking when unmonitored); (3) remedy one (monitoring/supervision); (4) remedy two (incentive pay, efficiency wages, or profit-sharing). Partial credit per element.",
      rationale: "Looking for the definition, a valid example, and two distinct remedies." },

    /* --- Ch17 (need 11) --- */
    { id: "ch17_availability", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "availability heuristic", points: 3,
      prompt: "People overestimate the risk of dramatic events (plane crashes, shark attacks) relative to mundane ones (car crashes). This reflects the:",
      options: ["availability heuristic \u2014 judging probability by how easily examples come to mind",
        "endowment effect", "sunk-cost fallacy", "anchoring bias"], answer: 0,
      rationale: "The availability heuristic leads people to overweight vivid, memorable events, distorting risk perception away from actual frequencies." },
    { id: "ch17_confirmation", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "confirmation bias", points: 3,
      prompt: "An investor who seeks out only news that supports a stock they already own is showing:",
      options: ["confirmation bias", "loss aversion", "the endowment effect", "framing"], answer: 0,
      rationale: "Confirmation bias is the tendency to seek, interpret, and remember information in a way that confirms one's prior beliefs, while discounting contrary evidence." },
    { id: "ch17_status_quo", chapter: 17, kind: "mc", render: "text", difficulty: "med", concept: "status quo bias", points: 1,
      prompt: "Sticking with a default insurance plan year after year without reevaluating reflects:",
      options: ["status-quo bias", "overconfidence", "the availability heuristic", "fairness preferences"], answer: 0,
      rationale: "Status-quo bias is the preference for keeping things as they are, a key reason default options are so influential." },
    { id: "ch17_rational_model", chapter: 17, kind: "mc", render: "text", difficulty: "med", concept: "standard model contrast", points: 1,
      prompt: "The standard economic model assumes people are rational maximizers. Behavioral economics argues this is:",
      options: ["a useful approximation that nonetheless misses systematic, predictable deviations",
        "completely correct in all cases", "useless and should be discarded entirely",
        "only about firms, not people"], answer: 0,
      rationale: "Behavioral economics doesn't reject optimization wholesale; it documents systematic biases the standard model misses, refining rather than replacing it." },
    { id: "ch17_gambler", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "gambler's fallacy", points: 3,
      prompt: "After a coin lands heads five times, believing tails is 'due' is the:",
      options: ["gambler's fallacy \u2014 wrongly thinking independent events are self-correcting",
        "availability heuristic", "endowment effect", "loss aversion"], answer: 0,
      rationale: "The gambler's fallacy is the mistaken belief that past independent outcomes change future probabilities; a fair coin remains 50/50 regardless of history." },
    { id: "ch17_present_bias_saving", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "present bias and saving", points: 3,
      prompt: "Present bias helps explain why many people:",
      options: ["save too little for retirement despite intending to save more",
        "always save the optimal amount", "never consume in the present",
        "ignore the present entirely"], answer: 0,
      rationale: "Present-biased preferences make immediate consumption very tempting, so people repeatedly postpone saving \u2014 a rationale for automatic-enrollment retirement plans." },
    { id: "ch17_commitment", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "commitment devices", points: 3,
      prompt: "A person who puts money in an account with an early-withdrawal penalty to force themselves to save is using a:",
      options: ["commitment device to overcome present bias",
        "sunk cost", "signal", "framing effect"], answer: 0,
      rationale: "A commitment device deliberately restricts one's future choices to counteract anticipated self-control problems (present bias) \u2014 e.g., penalty-locked savings, gym contracts." },
    { id: "ch17_fairness_pricing", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "fairness in pricing", points: 3,
      prompt: "Firms often avoid raising prices sharply during emergencies (e.g., snow shovels in a blizzard) even when demand spikes, because:",
      options: ["consumers perceive such increases as unfair and may punish the firm later",
        "it is always illegal", "higher prices reduce their profit",
        "demand is perfectly elastic"], answer: 0,
      rationale: "Perceptions of fairness affect behavior: customers may boycott or resent 'price gouging,' so firms sometimes forgo short-run profit to preserve goodwill \u2014 a departure from pure profit-maximization." },
    { id: "ch17_choice_overload", chapter: 17, kind: "mc", render: "text", difficulty: "hard", concept: "choice overload", points: 3,
      prompt: "Offering consumers a very large number of options can sometimes REDUCE the likelihood they buy anything. This 'choice overload' challenges the standard assumption that:",
      options: ["more options are always weakly better for a rational chooser",
        "people dislike all choices", "prices determine demand",
        "firms maximize profit"], answer: 0,
      rationale: "Standard theory says extra options can't hurt (you can ignore them). Choice overload shows that too many options can overwhelm people, causing them to defer or avoid deciding." },
    { id: "ch17_written_behavioral_policy", chapter: 17, kind: "short", render: "text", difficulty: "hard", concept: "behavioral policy design", points: 3,
      prompt: "A government wants more people to save for retirement. Using behavioral concepts, explain why simply offering a savings program may not work, and design two features (based on behavioral insights) that would raise participation.",
      answer: null,
      rubric: "Full credit: (1) present bias/procrastination and status-quo bias mean people intend to enroll but never do; (2) feature one: automatic enrollment (default) so inertia works FOR saving; (3) feature two: auto-escalation of contributions, or a commitment device, or simplification; (4) explanation tying each feature to the bias it addresses. Partial credit per element.",
      rationale: "Looking for the present-bias/inertia diagnosis and two behaviorally-grounded design features (defaults, escalation, commitment) that address them." },
    { id: "ch17_written_loss_aversion", chapter: 17, kind: "short", render: "text", difficulty: "hard", concept: "loss aversion applications", points: 3,
      prompt: "Define loss aversion and the endowment effect, explain how they are related, and give a real-world example where loss aversion leads to a choice the standard rational model would not predict.",
      answer: null,
      rubric: "Full credit: (1) loss aversion = losses loom larger than equivalent gains; (2) endowment effect = valuing an owned item more than the same item unowned; (3) relation: the endowment effect follows from loss aversion (giving up an owned item feels like a loss); (4) a valid example (refusing to sell a stock at a loss, demanding high price to give up a mug, reluctance to switch defaults). Partial credit per element.",
      rationale: "Looking for both definitions, the loss-aversion-to-endowment-effect link, and a valid non-rational example." }
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
