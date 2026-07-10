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
       webhook can match the payment back to this account */
    var ref = session && session.user ? session.user.id : "";
    var url = CHECKOUT_URL + (CHECKOUT_URL.indexOf("?") >= 0 ? "&" : "?") +
      "client_reference_id=" + encodeURIComponent(ref);
    global.location.href = url;
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

  /* ---- SCORES / GRADES (student's own) ------------------------------------- */
  function getMyScores(cb) {
    if (!init() || !session) { cb([]); return; }
    sb.from("im_score").select("arena_slug,attempted,correct,best_streak,score_pct")
      .then(function (res) { cb(res && res.data ? res.data : []); })
      .catch(function () { cb([]); });
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
    getMyScores: getMyScores,
    isOnline: function () { return hasSDK(); }
  };
})(this);
