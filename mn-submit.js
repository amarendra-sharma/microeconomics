/* ============================================================================
   mn-submit.js -- durable submission for every MacroNations course.
   v1.0.0   Drop-in, no build step, no dependencies.

   THE PROBLEM IT SOLVES
   A graded submission used to be one fetch(). If it failed -- a cold worker, a
   saturated connection pool, a student's wifi dropping between the lecture hall
   and the car park -- the answers existed only in page memory. Close the tab and
   the work was gone, and the student had no way to prove they had done it.

   WHAT THIS DOES
     1. Writes the answers to localStorage BEFORE the first network call.
     2. Retries with exponential backoff and jitter, so 200 students failing at
        once do not all retry in the same instant and re-create the spike.
     3. Sends a stable submission_id, so a retry that lands after the original
        actually succeeded is recognised server-side and does not double-count.
        (Server side: im_claim_submission / im_finish_submission, im_76.)
     4. Keeps the draft until the server confirms, and offers it back on reload.

   CONVENTIONS: ES5 only -- no arrow functions, template literals, optional
   chaining, let or const -- matching the rest of the MacroNations front end so
   it runs on older Safari without a transpile step.

   USAGE
     MNSubmit.send({
       url:      SUPABASE_URL + "/functions/v1/im-grade-quiz",
       apikey:   SUPABASE_ANON_KEY,
       token:    session.access_token,
       draftKey: "quiz:ch6",            // stable per sitting
       body:     { chapter: 6, items: items },
       onStatus: function (s) { ... },  // "saved" | "sending" | "retrying" | "ok" | "failed"
       onDone:   function (result) { ... },
       onFail:   function (info) { ... }
     });

     MNSubmit.listDrafts()           -> [{ key, savedAt, attempts, body }]
     MNSubmit.resume(key, opts)      -> retry a draft left over from last session
     MNSubmit.clearDraft(key)
   ========================================================================== */
(function (global) {
  "use strict";

  var NS = "mn.submit.";
  var MAX_ATTEMPTS = 6;
  // 0.6s, 1.2s, 2.4s, 4.8s, 9.6s (capped at 15s), each +/- 25% jitter.
  var BASE_DELAY_MS = 600;
  var MAX_DELAY_MS = 15000;

  // Retry only what might succeed later. A 400 means the payload is wrong and a
  // 401/403 means sign-in or enrolment -- repeating those just wastes the
  // student's time and hammers a server that is already saying no.
  var RETRY_STATUS = { 408: 1, 425: 1, 429: 1, 500: 1, 502: 1, 503: 1, 504: 1, 522: 1, 524: 1 };

  function uuid() {
    try {
      if (global.crypto && global.crypto.randomUUID) { return global.crypto.randomUUID(); }
      if (global.crypto && global.crypto.getRandomValues) {
        var b = new Uint8Array(16);
        global.crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        var h = [], i;
        for (i = 0; i < 16; i++) { h.push((b[i] + 0x100).toString(16).slice(1)); }
        return h[0]+h[1]+h[2]+h[3]+"-"+h[4]+h[5]+"-"+h[6]+h[7]+"-"+h[8]+h[9]+"-"+h[10]+h[11]+h[12]+h[13]+h[14]+h[15];
      }
    } catch (e) { /* fall through */ }
    // Last resort. Weaker, but it only has to be unique among one student's
    // own submissions, and the server scopes the id to that student anyway.
    var s = "", k;
    for (k = 0; k < 32; k++) { s += Math.floor(Math.random() * 16).toString(16); }
    return s.slice(0,8)+"-"+s.slice(8,12)+"-4"+s.slice(13,16)+"-a"+s.slice(17,20)+"-"+s.slice(20,32);
  }

  /* ---- draft storage ------------------------------------------------------
     Every read and write is wrapped: localStorage throws in Safari private
     browsing and can be disabled entirely. A student whose browser refuses
     storage must still be able to submit -- they just lose the safety net. */
  function store() {
    try {
      var t = global.localStorage;
      t.setItem(NS + "__probe", "1");
      t.removeItem(NS + "__probe");
      return t;
    } catch (e) { return null; }
  }

  function saveDraft(key, rec) {
    var s = store(); if (!s) { return false; }
    try { s.setItem(NS + key, JSON.stringify(rec)); return true; }
    catch (e) { return false; }   // quota exceeded -- proceed without the net
  }

  function readDraft(key) {
    var s = store(); if (!s) { return null; }
    try {
      var raw = s.getItem(NS + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearDraft(key) {
    var s = store(); if (!s) { return; }
    try { s.removeItem(NS + key); } catch (e) { /* ignore */ }
  }

  function listDrafts() {
    var s = store(); if (!s) { return []; }
    var out = [], i, k, rec;
    try {
      for (i = 0; i < s.length; i++) {
        k = s.key(i);
        if (!k || k.indexOf(NS) !== 0) { continue; }
        try { rec = JSON.parse(s.getItem(k)); } catch (e) { continue; }
        if (rec && rec.body) {
          out.push({ key: k.slice(NS.length), savedAt: rec.savedAt,
                     attempts: rec.attempts || 0, submissionId: rec.submission_id, body: rec.body });
        }
      }
    } catch (e) { /* ignore */ }
    out.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
    return out;
  }

  function backoff(attempt) {
    var d = BASE_DELAY_MS * Math.pow(2, attempt);
    // Jitter matters more than the delay itself: without it every student who
    // failed at the same moment retries at the same moment, and the second
    // wave is as sharp as the first.
    var jittered = d * (0.75 + Math.random() * 0.5);
    // Cap AFTER jittering. Capping first lets the jitter push the result back
    // over the ceiling, which is how a "15 second maximum" quietly becomes 18.
    return Math.round(Math.min(jittered, MAX_DELAY_MS));
  }

  function send(opts) {
    if (!opts || !opts.url || !opts.body) { throw new Error("MNSubmit.send: url and body are required"); }

    var key = opts.draftKey || ("auto:" + uuid());
    var status = opts.onStatus || function () {};
    var done = opts.onDone || function () {};
    var fail = opts.onFail || function () {};

    // Reuse an existing draft's id so a resumed submission is still recognised
    // as the SAME submission by the server, not a second one.
    var prior = readDraft(key);
    var submissionId = (prior && prior.submission_id) ? prior.submission_id : uuid();

    var record = {
      submission_id: submissionId,
      body: opts.body,
      savedAt: Date.now(),
      attempts: (prior && prior.attempts) ? prior.attempts : 0,
      url: opts.url
    };
    var stored = saveDraft(key, record);
    status(stored ? "saved" : "saved-nostore");

    var payload = {};
    var f;
    for (f in opts.body) { if (Object.prototype.hasOwnProperty.call(opts.body, f)) { payload[f] = opts.body[f]; } }
    payload.submission_id = submissionId;

    var headers = { "Content-Type": "application/json" };
    if (opts.apikey) { headers.apikey = opts.apikey; }
    if (opts.token) { headers.Authorization = "Bearer " + opts.token; }

    var attempt = 0;
    var aborted = false;

    function attemptOnce() {
      if (aborted) { return; }
      status(attempt === 0 ? "sending" : "retrying");
      record.attempts = attempt + 1;
      saveDraft(key, record);

      var timer = null;
      var controller = null;
      try { if (global.AbortController) { controller = new global.AbortController(); } } catch (e) { controller = null; }

      var init = { method: "POST", headers: headers, body: JSON.stringify(payload) };
      if (controller) {
        init.signal = controller.signal;
        // A request left hanging is worse than a failed one: the student stares
        // at a spinner while their time limit runs out. Cut it and retry.
        timer = global.setTimeout(function () { try { controller.abort(); } catch (e) {} }, opts.timeoutMs || 25000);
      }

      global.fetch(opts.url, init).then(function (res) {
        if (timer) { global.clearTimeout(timer); }
        if (res.status === 401 || res.status === 403) {
          return res.json().catch(function () { return {}; }).then(function (b) {
            giveUp({ kind: res.status === 401 ? "auth" : "forbidden", status: res.status, body: b });
          });
        }
        if (!res.ok) {
          if (RETRY_STATUS[res.status] && attempt + 1 < MAX_ATTEMPTS) { return schedule(); }
          return res.text().catch(function () { return ""; }).then(function (t) {
            giveUp({ kind: "http", status: res.status, detail: t });
          });
        }
        return res.json().catch(function () { return null; }).then(function (data) {
          // The server may say "another worker is still grading this exact
          // submission" (im_claim_submission returned claimed=false with no
          // stored result). That is a wait, not a failure.
          if (data && data.retry_after_ms && attempt + 1 < MAX_ATTEMPTS) {
            return schedule(data.retry_after_ms);
          }
          clearDraft(key);
          status("ok");
          done(data || { ok: true, noBody: true });
        });
      }).catch(function (err) {
        if (timer) { global.clearTimeout(timer); }
        if (attempt + 1 < MAX_ATTEMPTS) { return schedule(); }
        giveUp({ kind: "network", detail: String(err && err.message ? err.message : err) });
      });
    }

    function schedule(explicitMs) {
      attempt += 1;
      var wait = explicitMs || backoff(attempt);
      // attemptOnce() emits "retrying" itself when it runs; emitting here too
      // made the UI count six retries for three.
      global.setTimeout(attemptOnce, wait);
    }

    function giveUp(info) {
      status("failed");
      // The draft deliberately SURVIVES a failure. It is the student's evidence
      // and their way back in: MNSubmit.resume(key) picks it up unchanged, with
      // the same submission_id, whenever the connection returns.
      info.draftKey = key;
      info.submissionId = submissionId;
      info.recoverable = (info.kind === "network" || info.kind === "http");
      fail(info);
    }

    attemptOnce();

    return { cancel: function () { aborted = true; }, draftKey: key, submissionId: submissionId };
  }

  function resume(key, opts) {
    var rec = readDraft(key);
    if (!rec || !rec.body) { return null; }
    var merged = { url: rec.url, body: rec.body, draftKey: key };
    var f;
    for (f in (opts || {})) { if (Object.prototype.hasOwnProperty.call(opts, f)) { merged[f] = opts[f]; } }
    return send(merged);
  }

  // Warn before leaving with work that never reached the server.
  function guardUnload() {
    try {
      global.addEventListener("beforeunload", function (e) {
        if (listDrafts().length === 0) { return; }
        e.preventDefault();
        e.returnValue = "";   // browsers show their own wording
        return "";
      });
    } catch (e) { /* ignore */ }
  }

  global.MNSubmit = {
    version: "1.0.0",
    send: send,
    resume: resume,
    listDrafts: listDrafts,
    clearDraft: clearDraft,
    guardUnload: guardUnload,
    _uuid: uuid,
    _backoff: backoff
  };
})(typeof window !== "undefined" ? window : this);
