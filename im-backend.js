/* ============================================================================
   im-backend.js  —  shared client module for the Intro Micro arena suite.

   One file, imported by all 13 arenas, that provides:
     * Supabase auth (email + password, separate Intro Micro accounts)
     * an access gate (im_has_access) that unlocks arenas after the $25 purchase
     * vaulted grading: submitArena() posts to the im-grade Edge Function and
       returns { correct, correctCode, score } — the answer keys are gone from
       the client entirely
     * a graceful OFFLINE fallback so an arena opened without a backend (e.g.
       a professor previewing the raw file) still runs on localStorage exactly
       as before.

   Design: this is deliberately framework-free and Safari-safe (no optional
   chaining, no template literals) to match the locked arena conventions.

   Usage in an arena (see the retrofit example in the delivery notes):
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="im-backend.js"></script>
     ... then call IMBackend.gradeCase(arenaSlug, caseIndex, chosenCode, cb)
     instead of grading locally.
   ============================================================================ */
(function (global) {
  "use strict";

  /* ---- CONFIG: reuse the MacroNations project (same URL + anon key) -------
     These are the existing MacroNations project's PUBLIC values — safe to ship
     in client code (the anon key is designed to be public; RLS is the guard). */
  var SUPABASE_URL = "https://rtaiivegcqqmdchpguzn.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_KCPCMiKYQoEUgG45DVF5uA_ke-UxQKm";
  var GRADE_FN_URL = SUPABASE_URL + "/functions/v1/im-grade";
  var GRADE_QUIZ_FN_URL = SUPABASE_URL + "/functions/v1/im-grade-quiz";
  var CHECKOUT_URL = "https://buy.stripe.com/8x2cMYbjfcsk2ON7se5ZC01"; /* MacroNations DEFAULT_PAYMENT_LINK */

  var sb = null;          /* supabase client, if the SDK loaded */
  var session = null;     /* current auth session */
  var accessCache = null; /* cached im_has_access result */

  function hasSDK() {
    return !!(typeof global.supabase !== "undefined" && global.supabase && global.supabase.createClient);
  }

  function init() {
    if (hasSDK() && !sb) {
      sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return sb;
  }

  /* ---- AUTH ---------------------------------------------------------------- */
  function getSession(cb) {
    if (!init()) { cb(null); return; }
    sb.auth.getSession().then(function (res) {
      session = res && res.data ? res.data.session : null;
      cb(session);
    }).catch(function () { cb(null); });
  }

  function signUp(email, password, displayName, cb) {
    if (!init()) { cb({ error: "offline" }); return; }
    sb.auth.signUp({ email: email, password: password }).then(function (res) {
      if (res.error) { cb({ error: res.error.message }); return; }
      /* create the im_person row (RLS lets a user insert their own) */
      var uid = res.data && res.data.user ? res.data.user.id : null;
      if (uid) {
        sb.from("im_person").upsert(
          { user_id: uid, email: email, display_name: displayName || null },
          { onConflict: "user_id" }
        ).then(function () { cb({ ok: true, needsConfirm: !res.data.session }); });
      } else {
        cb({ ok: true, needsConfirm: true });
      }
    }).catch(function (e) { cb({ error: String(e) }); });
  }

  function signIn(email, password, cb) {
    if (!init()) { cb({ error: "offline" }); return; }
    sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      if (res.error) { cb({ error: res.error.message }); return; }
      session = res.data.session;
      accessCache = null;
      /* reconcile any pay-before-signin activation, then report access */
      sb.rpc("im_reconcile_activation").then(function () {
        cb({ ok: true });
      }).catch(function () { cb({ ok: true }); });
    }).catch(function (e) { cb({ error: String(e) }); });
  }

  function signOut(cb) {
    if (!init()) { cb && cb(); return; }
    sb.auth.signOut().then(function () {
      session = null; accessCache = null; cb && cb();
    });
  }

  /* ---- ACCESS GATE --------------------------------------------------------- */
  function checkAccess(cb) {
    if (!init()) { cb(true); return; }  /* offline preview: don't block */
    if (accessCache !== null) { cb(accessCache); return; }
    sb.rpc("im_has_access").then(function (res) {
      accessCache = !!(res && res.data);
      cb(accessCache);
    }).catch(function () { cb(false); });
  }

  function goToCheckout() {
    /* send the user to Stripe with their user_id as client_reference_id so the
       webhook can match the payment back to this account. Prefer the admin-
       configured link from pricing settings; fall back to the default. */
    var ref = session && session.user ? session.user.id : "";
    function go(base) {
      var url = base + (base.indexOf("?") >= 0 ? "&" : "?") +
        "client_reference_id=" + encodeURIComponent(ref);
      global.location.href = url;
    }
    getPricing(function (p) {
      go(p && p.stripeLink ? p.stripeLink : CHECKOUT_URL);
    });
  }

  /* ---- VAULTED GRADING ----------------------------------------------------- */
  /* gradeCase: key-mode arenas. Posts {arena_slug, case_index, submitted} and
     returns via cb({ correct, correctCode, score }) or cb({ offline:true }) so
     the caller can fall back to its local key. */
  function gradeCase(arenaSlug, caseIndex, submitted, cb) {
    postGrade({ arena_slug: arenaSlug, case_index: caseIndex, submitted: submitted }, cb);
  }

  /* gradePerformance: profit-arena. Posts achieved vs round_max. */
  function gradePerformance(arenaSlug, achieved, roundMax, cb) {
    postGrade({ arena_slug: arenaSlug, achieved: achieved, round_max: roundMax }, cb);
  }

  function postGrade(payload, cb) {
    if (!session || !session.access_token) { cb({ offline: true }); return; }
    global.fetch(GRADE_FN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + session.access_token
      },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (r.status === 403) { cb({ needEnroll: true }); return null; }
      if (!r.ok) { cb({ offline: true }); return null; }
      return r.json();
    }).then(function (data) {
      if (data) { cb(data); }
    }).catch(function () { cb({ offline: true }); });
  }

  /* ---- QUIZ GRADING (randomized items, server regenerates from seed) ------
     payload items: [{ generator_id, seed, submitted }]. The Edge Function
     grades MC/numeric deterministically and written answers via AI, writing
     an im_exam_attempt row per item. cb receives
     { ok, score, total, pending } or { offline:true } / { needEnroll:true }. */
  function gradeQuiz(chapter, items, cb) {
    if (!session || !session.access_token) { cb({ offline: true }); return; }
    global.fetch(GRADE_QUIZ_FN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + session.access_token
      },
      body: JSON.stringify({ chapter: chapter, items: items })
    }).then(function (r) {
      if (r.status === 403) { cb({ ok: false, needEnroll: true }); return null; }
      if (!r.ok) { cb({ ok: false, offline: true }); return null; }
      return r.json();
    }).then(function (data) {
      if (data) { cb(data); }
    }).catch(function () { cb({ ok: false, offline: true }); });
  }

  /* expose the supabase client for modules that need direct reads (e.g. the
     quiz engine's best-effort practice log). Returns null if not initialized. */
  function _sb() { return init() ? sb : null; }

  /* ---- SCORES / GRADES (student's own) ------------------------------------- */
  function getMyScores(cb) {
    if (!init() || !session) { cb([]); return; }
    sb.from("im_score").select("arena_slug,attempted,correct,best_streak,score_pct")
      .then(function (res) { cb(res && res.data ? res.data : []); })
      .catch(function () { cb([]); });
  }

  /* ---- CONTENT GATE (freemium) -------------------------------------------
     Call IMBackend.gateContent() from a gated chapter/arena. It checks access
     and, if the visitor is NOT entitled, overlays the page with a sign-in /
     unlock prompt. Free files simply never call this. Offline (no backend)
     leaves content open so raw-file previews still work. */
  function buildOverlay(mode) {
    var ov = global.document.getElementById("im-gate-overlay");
    if (ov) { ov.parentNode.removeChild(ov); }
    ov = global.document.createElement("div");
    ov.id = "im-gate-overlay";
    ov.setAttribute("style",
      "position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,0.86);" +
      "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);" +
      "display:flex;align-items:center;justify-content:center;padding:1.5rem;" +
      "font-family:'Inter',system-ui,sans-serif;");
    var signInBlock =
      "<div style='margin-top:1.25rem;text-align:left;'>" +
        "<input id='im-gate-email' type='email' placeholder='email' style='width:100%;padding:0.6rem 0.75rem;margin-bottom:0.5rem;border:1px solid #cbd5e1;border-radius:8px;font-size:0.9rem;'>" +
        "<input id='im-gate-pass' type='password' placeholder='password' style='width:100%;padding:0.6rem 0.75rem;margin-bottom:0.75rem;border:1px solid #cbd5e1;border-radius:8px;font-size:0.9rem;'>" +
        "<button id='im-gate-signin' style='width:100%;padding:0.65rem;border:none;border-radius:8px;background:#0f3d9e;color:#fff;font-weight:600;font-size:0.9rem;cursor:pointer;'>Sign in</button>" +
        "<div id='im-gate-msg' style='color:#991b1b;font-size:0.8rem;margin-top:0.5rem;min-height:1em;'></div>" +
      "</div>";
    var unlockBlock =
      "<button id='im-gate-unlock' style='margin-top:1.25rem;width:100%;padding:0.7rem;border:none;border-radius:8px;background:#b87408;color:#fff;font-weight:700;font-size:0.95rem;cursor:pointer;'>Unlock the full course</button>" +
      "<button id='im-gate-signout' style='margin-top:0.5rem;width:100%;padding:0.55rem;border:1px solid #cbd5e1;border-radius:8px;background:transparent;color:#334155;font-weight:600;font-size:0.85rem;cursor:pointer;'>Sign out</button>";
    var body = mode === "unlock"
      ? "<p style='color:#475569;font-size:0.95rem;line-height:1.6;margin-top:0.5rem;'>You're signed in, but this chapter is part of the full course. Chapters 1&ndash;3 and the Market Sandbox are free; unlocking gives you all 17 chapters, all 12 arenas, exams, and your gradebook.</p>" + unlockBlock
      : "<p style='color:#475569;font-size:0.95rem;line-height:1.6;margin-top:0.5rem;'>This chapter is part of the full course. Sign in to your Intro Micro account to continue, or head back to the free preview.</p>" + signInBlock;
    ov.innerHTML =
      "<div style='background:#fff;border-radius:16px;max-width:400px;width:100%;padding:2rem;box-shadow:0 20px 50px rgba(0,0,0,0.35);text-align:center;'>" +
        "<div style='font-size:1.75rem;'>&#128274;</div>" +
        "<h2 style='font-family:Georgia,serif;font-size:1.35rem;margin:0.5rem 0 0;color:#0f172a;'>Full course content</h2>" +
        body +
        "<div style='margin-top:1rem;'><a href='index.html' style='color:#64748b;font-size:0.85rem;text-decoration:underline;'>&larr; Back to the portal</a></div>" +
      "</div>";
    global.document.body.appendChild(ov);

    var si = global.document.getElementById("im-gate-signin");
    if (si) {
      si.addEventListener("click", function () {
        var e = global.document.getElementById("im-gate-email");
        var p = global.document.getElementById("im-gate-pass");
        var m = global.document.getElementById("im-gate-msg");
        if (!e || !p || !e.value || !p.value) { if (m) { m.textContent = "Enter email and password."; } return; }
        signIn(e.value, p.value, function (res) {
          if (res && res.ok) {
            accessCache = null;
            checkAccess(function (ok2) {
              if (ok2) { removeOverlay(); }
              else { buildOverlay("unlock"); }
            });
          } else if (m) { m.textContent = res && res.error ? res.error : "Sign-in failed."; }
        });
      });
    }
    var un = global.document.getElementById("im-gate-unlock");
    if (un) {
      un.addEventListener("click", function () { goToCheckout(); });
      /* fill in the admin-controlled price */
      getPricing(function (p) {
        if (p && typeof p.priceCents === "number") {
          un.innerHTML = "Unlock the full course &mdash; " + formatPrice(p.priceCents, p.currency);
        } else {
          un.innerHTML = "Unlock the full course";
        }
      });
    }
    var so = global.document.getElementById("im-gate-signout");
    if (so) { so.addEventListener("click", function () { signOut(function () { buildOverlay("signin"); }); }); }
  }

  function removeOverlay() {
    var ov = global.document.getElementById("im-gate-overlay");
    if (ov) { ov.parentNode.removeChild(ov); }
  }

  function gateContent() {
    /* offline / no backend: leave content open (preview mode) */
    if (!hasSDK()) { return; }
    getSession(function (sessionNow) {
      checkAccess(function (ok) {
        if (ok) { removeOverlay(); return; }
        buildOverlay(sessionNow && sessionNow.user ? "unlock" : "signin");
      });
    });
  }

  /* ---- PRICING (public, from im_public_pricing view) ---------------------
     Reads the admin-controlled price + Stripe link so display text has a single
     source of truth. Cached after first fetch. cb receives
     { priceCents, currency, stripeLink } or null on failure/offline. */
  var pricingCache = null;
  function getPricing(cb) {
    if (pricingCache) { cb(pricingCache); return; }
    if (!init()) { cb(null); return; }
    sb.from("im_public_pricing").select("price_cents,currency,stripe_link").maybeSingle()
      .then(function (res) {
        if (res && res.data) {
          pricingCache = {
            priceCents: res.data.price_cents,
            currency: res.data.currency ? res.data.currency : "usd",
            stripeLink: res.data.stripe_link ? res.data.stripe_link : ""
          };
          cb(pricingCache);
        } else { cb(null); }
      }).catch(function () { cb(null); });
  }

  /* format cents as a price string, e.g. 2500 -> "$25" ("$25.50" if needed) */
  function formatPrice(cents, currency) {
    if (typeof cents !== "number") { return ""; }
    var dollars = cents / 100;
    var sym = (currency === "usd" || !currency) ? "$" : "";
    var str = (dollars === Math.floor(dollars)) ? String(dollars) : dollars.toFixed(2);
    return sym + str;
  }

  global.IMBackend = {
    init: init,
    getSession: getSession,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    checkAccess: checkAccess,
    goToCheckout: goToCheckout,
    gradeCase: gradeCase,
    gradePerformance: gradePerformance,
    gradeQuiz: gradeQuiz,
    getMyScores: getMyScores,
    gateContent: gateContent,
    getPricing: getPricing,
    formatPrice: formatPrice,
    _sb: _sb,
    isOnline: function () { return hasSDK(); }
  };
})(this);
