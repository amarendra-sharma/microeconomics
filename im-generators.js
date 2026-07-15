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
