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
