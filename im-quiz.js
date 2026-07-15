/* ============================================================================
   im-quiz.js  —  student practice & graded-quiz engine for Intro Micro.

   Depends on (must be loaded first):
     * im-diagrams.js   -> global IMDiagrams.render(spec)
     * im-generators.js -> global IMGenerators.generate/grade/list
     * im-backend.js    -> global IMBackend (auth, supabase client) [graded mode]

   TWO MODES
     practice(chapter, mountEl)      ungraded drilling. Generates random items
                                     from the chapter bank, shows immediate
                                     feedback + rationale, logs to im_practice_log.
     quiz(examId, mountEl)           graded, soft-proctored chapter quiz. Draws a
                                     fixed set of items (with per-student seeds),
                                     collects answers, submits to the grading
                                     Edge Function. No answers revealed until
                                     after submit (per policy).

   Answers are NEVER shipped for graded quizzes: the client only holds the seed
   and the generated PROMPT; grading happens server-side by regenerating from
   the seed. For PRACTICE, immediate feedback is fine, so we grade locally with
   IMGenerators.grade (practice is ungraded, so no integrity concern).

   Safari-safe plain JS.
   ============================================================================ */
(function (global) {
  "use strict";

  var doc = global.document;

  function el(tag, attrs, html) {
    var e = doc.createElement(tag);
    if (attrs) { for (var k in attrs) { if (attrs.hasOwnProperty(k)) { e.setAttribute(k, attrs[k]); } } }
    if (html != null) { e.innerHTML = html; }
    return e;
  }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function rand32() { return Math.floor(Math.random() * 0xFFFFFFFF) >>> 0; }

  /* which generators + static items belong to each chapter's bank.
     In production this comes from im_bank_items; we keep a local fallback map
     so practice works even before the DB bank is populated. */
  var CH_BANK = {
    1: ['opp_cost_basic', 'marginal_decision', 'ch1_opportunity_cost_def', 'ch1_incentives', 'ch1_written_tradeoff', 'ch1_scarcity', 'ch1_efficiency_equity', 'ch1_rational_margin', 'ch1_sunk_cost', 'ch1_invisible_hand', 'ch1_market_failure', 'ch1_productivity', 'ch1_inflation_money', 'ch1_phillips_tradeoff', 'ch1_gains_trade_principle', 'ch1_opp_cost_college', 'ch1_incentive_unintended', 'ch1_role_of_prices', 'ch1_written_incentive_policy', 'ch1_written_efficiency_equity', 'ch1_specialization', 'ch1_central_planning', 'ch1_govt_property_rights', 'ch1_marginal_benefit_water'],
    2: ['ppf_opportunity_cost', 'positive_normative', 'ch2_ppf_concept', 'ch2_micro_macro', 'ch2_circular_flow', 'ch2_model_assumptions', 'ch2_economist_scientist', 'ch2_ppf_efficiency', 'ch2_ppf_growth', 'ch2_ppf_opportunity_bowed', 'ch2_micro_macro_2', 'ch2_positive_normative_2', 'ch2_economists_disagree', 'ch2_ceteris_paribus_model', 'ch2_theory_data', 'ch2_ppf_unattainable', 'ch2_ppf_tradeoff_written', 'ch2_written_positive_normative', 'ch2_model_map', 'ch2_factor_market'],
    3: ['comparative_advantage', 'opp_cost_table', 'ch3_ppf_oppcost_graph', 'ch3_ppf_point_type', 'ch3_ppf_slope_oppcost', 'ch3_ppf_efficient_point', 'ch3_ppf_tradeoff_graph', 'ch3_absolute_vs_comparative', 'ch3_written_gains_trade', 'ch3_absolute_advantage_def', 'ch3_comparative_def', 'ch3_terms_of_trade', 'ch3_specialization_gain', 'ch3_who_produces_what', 'ch3_import_export', 'ch3_self_sufficiency', 'ch3_opp_cost_reciprocal', 'ch3_both_gain', 'ch3_absolute_both', 'ch3_ca_numeric_hours', 'ch3_ppf_trade_written', 'ch3_written_absolute_vs_comp', 'ch3_trade_not_zero_sum', 'ch3_ca_table_reading', 'ch3_interdependence'],
    4: ['sd_equilibrium', 'sd_equilibrium_graph', 'sd_shift_effect', 'sd_qd_at_price', 'sd_surplus_shortage', 'sd_determinant', 'sd_double_shift', 'sd_equilibrium_price_graph', 'ch4_read_eq_quantity', 'ch4_shift_graph_effect', 'ch4_read_eq_price', 'ch4_law_demand_mc', 'ch4_change_qd_vs_d', 'ch4_written_shortage', 'ch4_ceteris_paribus', 'ch4_normal_inferior', 'ch4_written_shift_vs_move', 'ch4_demand_def', 'ch4_supply_def', 'ch4_substitute_shift', 'ch4_complement_shift', 'ch4_supply_determinant', 'ch4_expectations_demand', 'ch4_equilibrium_def', 'ch4_surplus_price', 'ch4_shortage_price', 'ch4_qd_calc2', 'ch4_equilibrium_calc2', 'ch4_normal_good', 'ch4_written_equilibrium_adjust'],
    5: ['elasticity_midpoint', 'elasticity_classify', 'elasticity_revenue', 'income_elasticity', 'ch5_steep_flat_graph', 'ch5_revenue_box_graph', 'ch5_linear_elasticity_graph', 'ch5_compare_slopes_graph', 'ch5_revenue_interpret_graph', 'ch5_elastic_determinants', 'ch5_written_revenue', 'ch5_elasticity_def', 'ch5_perfectly_inelastic', 'ch5_perfectly_elastic', 'ch5_determinant_necessity', 'ch5_time_horizon', 'ch5_cross_price_substitutes', 'ch5_cross_price_complements', 'ch5_supply_elasticity', 'ch5_total_revenue_inelastic', 'ch5_unit_elastic', 'ch5_midpoint_why', 'ch5_slope_vs_elasticity', 'ch5_income_elastic_luxury', 'ch5_farm_paradox', 'ch5_elasticity_classify_num', 'ch5_written_elasticity_pricing'],
    6: ['ceiling_shortage', 'floor_surplus', 'tax_quantity', 'tax_incidence', 'ch6_tax_buyer_price_graph', 'ch6_floor_surplus_graph2', 'ch6_ceiling_concept', 'ch6_tax_wedge', 'ch6_ceiling_binding', 'ch6_floor_binding', 'ch6_rent_control', 'ch6_min_wage', 'ch6_tax_burden_independent', 'ch6_tax_wedge_concept', 'ch6_shortage_nonprice', 'ch6_surplus_consequence', 'ch6_who_bears_inelastic', 'ch6_subsidy', 'ch6_ceiling_calc', 'ch6_floor_calc', 'ch6_price_control_tradeoff', 'ch6_written_rent_control', 'ch6_written_tax_incidence', 'ch6_shortage_or_surplus'],
    7: ['sd_consumer_surplus', 'sd_producer_surplus', 'sd_total_surplus', 'welfare_efficiency', 'cs_from_wtp', 'ps_from_cost', 'dwl_underproduction', 'wtp_concept', 'ch7_cs_area_graph', 'ch7_total_surplus_graph', 'ch7_ps_area_graph', 'ch7_consumer_surplus_def', 'ch7_written_efficiency', 'ch7_written_surplus_meaning', 'ch7_ps_def', 'ch7_cs_area', 'ch7_ps_area', 'ch7_willingness_to_pay', 'ch7_cost_seller', 'ch7_efficiency_def', 'ch7_equilibrium_efficient', 'ch7_underproduction_loss', 'ch7_overproduction_loss', 'ch7_cs_calc2', 'ch7_ps_calc2', 'ch7_total_surplus_def', 'ch7_price_transfer', 'ch7_written_invisible_hand'],
    8: ['tax_dwl', 'tax_revenue', 'dwl_tax_size', 'ch8_dwl_area_graph', 'ch8_dwl_compare_graph', 'ch8_revenue_area_graph', 'ch8_dwl_concept', 'ch8_written_tax_tradeoff', 'ch8_dwl_def', 'ch8_dwl_source', 'ch8_dwl_elasticity', 'ch8_dwl_inelastic_small', 'ch8_laffer', 'ch8_revenue_vs_rate', 'ch8_dwl_grows_square', 'ch8_who_pays_dwl', 'ch8_optimal_tax_base', 'ch8_dwl_calc', 'ch8_revenue_calc', 'ch8_total_surplus_after_tax', 'ch8_tax_incidence_dwl', 'ch8_written_dwl_size', 'ch8_written_double_tax', 'ch8_transfer_vs_loss'],
    9: ['marginal_cost_calc', 'average_total_cost', 'fixed_variable_cost', 'mc_atc_relationship', 'ch9_efficient_scale_graph', 'ch9_identify_curve_graph', 'ch9_mc_crosses_atc_graph', 'ch9_avc_below_atc_graph', 'ch9_economies_scale', 'ch9_written_mc_atc', 'ch9_explicit_implicit', 'ch9_economic_vs_accounting_profit', 'ch9_production_function', 'ch9_diminishing_marginal_product', 'ch9_mp_mc_link', 'ch9_fixed_cost_def', 'ch9_avg_fixed_falls', 'ch9_mc_atc_cross', 'ch9_mc_below_atc', 'ch9_efficient_scale', 'ch9_economies_diseconomies', 'ch9_short_run_long_run', 'ch9_mc_calc', 'ch9_atc_calc', 'ch9_written_economic_profit', 'ch9_written_mc_shape'],
    10: ['profit_max_pmc', 'shutdown_decision', 'firm_profit_calc', 'ch10_profit_max_graph', 'ch10_profit_loss_graph', 'ch10_shutdown_graph', 'ch10_zero_profit_graph', 'ch10_firm_demand_graph', 'ch10_pmc_rule', 'ch10_written_shutdown', 'ch10_price_taker', 'ch10_mr_equals_price', 'ch10_profit_max_rule', 'ch10_shutdown_rule', 'ch10_exit_rule', 'ch10_sunk_fixed', 'ch10_supply_curve', 'ch10_zero_profit', 'ch10_entry_effect', 'ch10_pmc_calc', 'ch10_profit_calc2', 'ch10_loss_calc', 'ch10_identical_products', 'ch10_written_shutdown_vs_exit', 'ch10_written_zero_profit', 'ch10_price_equals_minatc']
  };

  /* ---- render a single question into a container -------------------------
     q = generated instance from IMGenerators.generate.
     onAnswer(value) called when the student commits an answer (practice). */
  function renderQuestion(q, container, opts) {
    opts = opts || {};
    container.innerHTML = "";
    var card = el("div", { "class": "imq-card", "style":
      "background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;" });

    /* difficulty + type badges */
    var meta = el("div", { "style": "display:flex;gap:8px;margin-bottom:10px;font-size:11px;" });
    var diffColor = q.difficulty === "hard" ? "#991b1b" : q.difficulty === "med" ? "#b87408" : "#166534";
    meta.appendChild(el("span", { "style":
      "padding:2px 8px;border-radius:10px;background:" + diffColor + "18;color:" + diffColor + ";font-weight:600;" },
      esc(q.difficulty || "med")));
    meta.appendChild(el("span", { "style":
      "padding:2px 8px;border-radius:10px;background:#0f3d9e14;color:#0f3d9e;font-weight:600;" },
      esc(q.kind === "mc" ? "Multiple choice" : q.kind === "numeric" ? "Numerical" : "Written")));
    if (q.concept) {
      meta.appendChild(el("span", { "style": "padding:2px 8px;color:#64748b;" }, esc(q.concept)));
    }
    card.appendChild(meta);

    /* prompt */
    card.appendChild(el("div", { "style": "font-size:15px;line-height:1.6;color:#0f172a;margin-bottom:14px;" },
      esc(q.prompt)));

    /* diagram (graphical items) */
    if (q.diagramSpec && global.IMDiagrams) {
      var dwrap = el("div", { "style": "max-width:440px;margin:0 auto 16px;" });
      dwrap.innerHTML = global.IMDiagrams.render(q.diagramSpec);
      card.appendChild(dwrap);
    }

    /* answer input area */
    var ansWrap = el("div", { "class": "imq-ans" });
    var getValue = null;

    if (q.kind === "mc") {
      var name = "imq_" + Math.random().toString(36).slice(2);
      q.options.forEach(function (optText, i) {
        var row = el("label", { "style":
          "display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:8px;cursor:pointer;font-size:14px;color:#0f172a;background:#ffffff;" });
        var radio = el("input", { "type": "radio", "name": name, "value": String(i), "style": "margin-top:2px;flex-shrink:0;" });
        var txt = el("span", { "style": "color:#0f172a;line-height:1.5;" }, esc(optText));
        row.appendChild(radio);
        row.appendChild(txt);
        ansWrap.appendChild(row);
      });
      getValue = function () {
        var checked = ansWrap.querySelector("input:checked");
        return checked ? checked.value : null;
      };
    } else if (q.kind === "numeric") {
      var inp = el("input", { "type": "text", "inputmode": "decimal", "placeholder": "Your answer",
        "style": "width:180px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px;" });
      ansWrap.appendChild(inp);
      getValue = function () { return inp.value.trim() === "" ? null : inp.value.trim(); };
    } else { /* short / written */
      var ta = el("textarea", { "rows": "5", "placeholder": "Write your answer\u2026",
        "style": "width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box;" });
      ansWrap.appendChild(ta);
      getValue = function () { return ta.value.trim() === "" ? null : ta.value.trim(); };
    }
    card.appendChild(ansWrap);

    /* action button + feedback slot */
    var fb = el("div", { "style": "margin-top:12px;min-height:1.2em;font-size:14px;" });
    var btn = el("button", { "style":
      "margin-top:12px;padding:9px 18px;border:none;border-radius:8px;background:#0f3d9e;color:#fff;font-weight:600;font-size:14px;cursor:pointer;" },
      opts.buttonLabel || "Check answer");
    btn.addEventListener("click", function () {
      var v = getValue();
      if (v == null) { fb.innerHTML = "<span style='color:#991b1b;'>Please answer first.</span>"; return; }
      if (opts.onAnswer) { opts.onAnswer(v, fb, btn); }
    });
    card.appendChild(btn);
    card.appendChild(fb);
    container.appendChild(card);
    return { getValue: getValue, feedback: fb, button: btn };
  }

  /* ---- PRACTICE MODE ------------------------------------------------------ */
  function practice(chapter, mountEl, cfg) {
    cfg = cfg || {};
    var bank = CH_BANK[chapter] || [];
    if (!bank.length) { mountEl.innerHTML = "<p>No practice questions for this chapter yet.</p>"; return; }
    var G = global.IMGenerators;

    var state = { idx: 0, correct: 0, answered: 0, seen: 0 };
    var total = bank.length;

    /* Draw generators by cycling through a shuffled order so the student sees
       every question in the chapter exactly once. When all have been shown,
       we display a "practice complete" screen instead of looping. */
    var deck = [];
    function shuffleDeck() {
      deck = bank.slice();
      for (var i = deck.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
      }
    }
    shuffleDeck();
    function nextGenId() {
      return deck.shift();
    }

    function showComplete() {
      var pct = state.answered > 0 ? Math.round((state.correct / state.answered) * 100) : null;
      var nextCh = chapter + 1;
      var hasNext = !!(CH_BANK[nextCh] && CH_BANK[nextCh].length);
      var html = "<div style='background:#f0fdf4;border:1px solid #166534;border-radius:12px;padding:22px;text-align:center;'>" +
        "<div style='font-size:20px;font-weight:800;color:#166534;margin-bottom:8px;'>\u2713 Practice complete</div>" +
        "<div style='color:#334155;font-size:15px;margin-bottom:6px;'>You've worked through all " + total +
        " practice questions for Chapter " + chapter + ".</div>";
      if (pct != null) {
        html += "<div style='color:#64748b;font-size:14px;margin-bottom:16px;'>Your score on graded items: " +
          state.correct + " / " + state.answered + " (" + pct + "%).</div>";
      }
      html += "<div style='display:flex;gap:10px;justify-content:center;flex-wrap:wrap;'>";
      html += "<button id='imqRestart' style='padding:9px 18px;border:1px solid #0f3d9e;border-radius:8px;background:#fff;color:#0f3d9e;font-weight:600;cursor:pointer;'>Practice this chapter again</button>";
      if (hasNext) {
        html += "<button id='imqNextCh' style='padding:9px 18px;border:none;border-radius:8px;background:#166534;color:#fff;font-weight:700;cursor:pointer;'>Go to Chapter " + nextCh + " \u2192</button>";
      }
      html += "</div></div>";
      mountEl.innerHTML = html;
      var rb = mountEl.querySelector("#imqRestart");
      if (rb) { rb.addEventListener("click", function () {
        state.correct = 0; state.answered = 0; state.seen = 0; shuffleDeck(); draw();
      }); }
      var nb = mountEl.querySelector("#imqNextCh");
      if (nb) { nb.addEventListener("click", function () {
        if (cfg.onNextChapter) { cfg.onNextChapter(nextCh); }
        else { practice(nextCh, mountEl, cfg); }
      }); }
    }

    function draw() {
      if (!deck.length) { showComplete(); return; }
      var genId = nextGenId();
      var seed = rand32();
      var q = G.generate(genId, seed);
      if (!q) { return; }
      state.seen++;

      var head = "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;'>" +
        "<div style='font-weight:700;color:#0f3d9e;font-size:16px;'>Chapter " + chapter + " \u00b7 Practice</div>" +
        "<div style='color:#64748b;font-size:13px;'>Question " + state.seen + " of " + total +
        " \u00b7 Score: " + state.correct + " / " + state.answered + "</div></div>";
      mountEl.innerHTML = head;
      var qbox = el("div"); mountEl.appendChild(qbox);

      renderQuestion(q, qbox, {
        buttonLabel: "Check answer",
        onAnswer: function (value, fb, btn) {
          btn.disabled = true; btn.style.opacity = "0.5";
          if (q.kind === "short") {
            /* written: no auto-grade in practice; show the rubric as self-check */
            fb.innerHTML = "<div style='background:#f5f0e8;border-radius:8px;padding:12px;color:#0f172a;'>" +
              "<b>Self-check.</b> " + esc(q.rubric || q.rationale || "Compare your answer to the key ideas.") + "</div>";
          } else {
            var res = G.grade(q.id, q.seed, value);
            state.answered++;
            if (res.correct) { state.correct++; }
            var color = res.correct ? "#166534" : "#991b1b";
            var label = res.correct ? "Correct" : "Not quite";
            fb.innerHTML = "<div style='color:" + color + ";font-weight:700;margin-bottom:6px;'>" + label + "</div>" +
              "<div style='color:#334155;'>" + esc(q.rationale || "") + "</div>" +
              (res.correct ? "" : "<div style='color:#64748b;margin-top:4px;'>Correct answer: " + esc(String(res.expected)) + "</div>");
            /* best-effort practice log (ungraded) */
            logPractice(chapter, q, res.correct);
          }
          var moreLeft = deck.length > 0;
          var next = el("button", { "style":
            "margin-top:14px;margin-left:10px;padding:9px 18px;border:1px solid #0f3d9e;border-radius:8px;background:#fff;color:#0f3d9e;font-weight:600;cursor:pointer;" },
            moreLeft ? "Next question \u2192" : "See results \u2192");
          next.addEventListener("click", draw);
          fb.parentNode.appendChild(next);
        }
      });
    }
    draw();
  }

  function logPractice(chapter, q, wasCorrect) {
    if (!global.IMBackend || !global.IMBackend.isOnline || !global.IMBackend.isOnline()) { return; }
    try {
      var sb = global.IMBackend._sb ? global.IMBackend._sb() : null;
      if (!sb) { return; }
      global.IMBackend.getSession(function (sess) {
        if (!sess || !sess.user) { return; }
        sb.from("im_practice_log").insert({
          student_id: sess.user.id, chapter: chapter,
          generator_id: q.id, seed: q.seed, was_correct: !!wasCorrect
        }).then(function () {}, function () {});
      });
    } catch (e) { /* practice logging is best-effort */ }
  }

  /* ---- GRADED QUIZ MODE (soft-proctored) ---------------------------------
     Builds a fixed list of items with per-student seeds, collects all answers,
     submits once to the grading Edge Function. Answers are not revealed inline. */
  function quiz(spec, mountEl, cfg) {
    /* spec: { chapter, items:[genId...], count } OR a server exam definition.
       For the proof-of-concept we build from the chapter bank. */
    cfg = cfg || {};
    var G = global.IMGenerators;
    var chapter = spec.chapter;
    var bank = spec.items || CH_BANK[chapter] || [];
    var count = spec.count || Math.min(5, bank.length);

    /* pick `count` items (no repeat), each with its own seed */
    var pick = [];
    var pool = bank.slice();
    for (var i = 0; i < count && pool.length; i++) {
      var j = Math.floor(Math.random() * pool.length);
      pick.push({ genId: pool[j], seed: rand32() });
      pool.splice(j, 1);
    }
    var instances = pick.map(function (p) {
      var q = G.generate(p.genId, p.seed);
      q._genId = p.genId; q._seed = p.seed;
      return q;
    });

    mountEl.innerHTML = "<div style='font-weight:700;color:#0f3d9e;font-size:18px;margin-bottom:6px;'>Chapter " +
      chapter + " Quiz</div><div style='color:#64748b;font-size:13px;margin-bottom:18px;'>" +
      instances.length + " questions \u00b7 answers are graded after you submit.</div>";
    var list = el("div"); mountEl.appendChild(list);

    var inputs = [];
    instances.forEach(function (q, i) {
      var qbox = el("div"); list.appendChild(qbox);
      var ctrl = renderQuestion(q, qbox, { buttonLabel: null, onAnswer: null });
      /* hide the per-question button in quiz mode (single submit at end) */
      if (ctrl.button) { ctrl.button.style.display = "none"; }
      inputs.push({ q: q, ctrl: ctrl });
    });

    var submit = el("button", { "style":
      "margin-top:8px;padding:11px 26px;border:none;border-radius:8px;background:#166534;color:#fff;font-weight:700;font-size:15px;cursor:pointer;" },
      "Submit quiz");
    var out = el("div", { "style": "margin-top:16px;" });
    submit.addEventListener("click", function () {
      var payload = inputs.map(function (row) {
        return { generator_id: row.q._genId, seed: row.q._seed, submitted: row.ctrl.getValue() };
      });
      submit.disabled = true; submit.style.opacity = "0.5"; submit.textContent = "Grading\u2026";
      gradeQuiz(chapter, payload, function (result) {
        if (result && result.ok) {
          out.innerHTML = "<div style='background:#f0fdf4;border:1px solid #166534;border-radius:10px;padding:16px;'>" +
            "<div style='font-weight:700;color:#166534;font-size:16px;'>Quiz submitted</div>" +
            "<div style='color:#334155;margin-top:6px;'>Score: " + result.score + " / " + result.total +
            (result.pending ? " (" + result.pending + " written answer(s) pending review)" : "") + "</div></div>";
        } else {
          out.innerHTML = "<div style='color:#991b1b;'>" +
            (result && result.error ? esc(result.error) : "Could not submit. Check your connection and try again.") +
            "</div>";
          submit.disabled = false; submit.style.opacity = "1"; submit.textContent = "Submit quiz";
        }
      });
    });
    mountEl.appendChild(submit);
    mountEl.appendChild(out);
  }

  /* submit graded answers to the Edge Function (server regenerates + grades) */
  function gradeQuiz(chapter, payload, cb) {
    if (!global.IMBackend || !global.IMBackend.isOnline || !global.IMBackend.isOnline()) {
      /* OFFLINE fallback: grade locally so the UI still works in dev/preview.
         (Not used in production — real grading is server-side.) */
      var G = global.IMGenerators, score = 0, total = 0, pending = 0;
      payload.forEach(function (p) {
        var r = G.grade(p.generator_id, p.seed, p.submitted);
        if (r.needsAI) { pending++; total += r.points || 0; }
        else { total += (G.generate(p.generator_id, p.seed).points || 1); if (r.correct) { score += r.points; } }
      });
      cb({ ok: true, score: score, total: total, pending: pending, offline: true });
      return;
    }
    global.IMBackend.gradeQuiz
      ? global.IMBackend.gradeQuiz(chapter, payload, cb)
      : cb({ ok: false, error: "Grading endpoint not wired yet." });
  }

  global.IMQuiz = { practice: practice, quiz: quiz, renderQuestion: renderQuestion, setBank: function (ch, ids) { CH_BANK[ch] = ids; } };
})(this);
