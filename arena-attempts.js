/* ===========================================================================
   arena-attempts.js  —  shared attempt controller for Intro Micro arenas

   One rule for every arena:
     - An ATTEMPT is one full pass through the arena's fixed set of cases.
     - The student gets TWO attempts. The second is OPTIONAL -- taken only if
       they're unhappy with the first.
     - One attempt  -> that attempt's score is the grade.
     - Two attempts -> the grade is the AVERAGE of the two.
     - After two attempts the arena LOCKS with a clear end screen.

   The arena tells this controller three things:
     ArenaAttempts.init({
       slug: 'market-sandbox',
       caseCount: 8,                 // cases in one full pass
       onAttemptEnd: function(info){ ... optional UI hook ... },
       mount: 'aa-panel'             // id of an element to render status into
     });
   and then calls ArenaAttempts.caseAnswered(isCorrect) once per graded case.

   The controller:
     - counts cases within the current attempt,
     - when caseCount is reached, closes the attempt, computes its score
       (correct / caseCount), records it, and shows the between/after screen,
     - blocks further play once two attempts are done,
     - records each attempt to the database via the progress module
       (SAProgress/IMProgress.recordArenaCase per case already writes the raw
       rows; this controller ALSO reports a per-attempt summary so the gradebook
       and My Progress can show attempt scores and their average).

   Requires sa-progress.js (SAProgress/IMProgress) loaded first for DB writes.
   Falls back to localStorage-only if the module isn't present, so the arena
   still runs offline.
   =========================================================================== */
(function (global) {
  "use strict";

  function mod() {
    if (typeof global.SAProgress !== "undefined") { return global.SAProgress; }
    if (typeof global.IMProgress !== "undefined") { return global.IMProgress; }
    return null;
  }

  var S = {
    slug: null,
    caseCount: 0,
    attemptIndex: 0,      // 0 = not started, 1 = on first attempt, 2 = on second
    answeredThisAttempt: 0,
    correctThisAttempt: 0,
    attemptScores: [],    // completed attempt fractions (0..1)
    locked: false,
    onAttemptEnd: null,
    onStartAttempt: null,
    mountId: null,
    recordCase: null,
    maxAttempts: 2
  };

  function lsKey() { return "arenaAttempts." + S.slug; }

  function load() {
    try {
      var raw = global.localStorage.getItem(lsKey());
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === "object") {
          S.attemptScores = Array.isArray(p.attemptScores) ? p.attemptScores : [];
          S.locked = S.attemptScores.length >= S.maxAttempts;
        }
      }
    } catch (e) { /* ignore */ }
  }

  function save() {
    try {
      global.localStorage.setItem(lsKey(), JSON.stringify({ attemptScores: S.attemptScores }));
    } catch (e) { /* ignore */ }
  }

  function averageScore() {
    if (S.attemptScores.length === 0) { return null; }
    var s = 0, i;
    for (i = 0; i < S.attemptScores.length; i++) { s += S.attemptScores[i]; }
    return s / S.attemptScores.length;
  }

  function pct(x) { return (x === null || x === undefined) ? "\u2014" : Math.round(x * 100) + "%"; }

  function render() {
    if (!S.mountId) { return; }
    var el = global.document.getElementById(S.mountId);
    if (!el) { return; }
    var done = S.attemptScores.length;
    var html = "";

    if (S.locked) {
      // both attempts used -> final screen
      html =
        '<div class="aa-card aa-done">' +
          '<div class="aa-title">Arena complete</div>' +
          '<div class="aa-scores">' +
            'Attempt 1: <strong>' + pct(S.attemptScores[0]) + '</strong>' +
            (S.attemptScores.length > 1 ? ' &nbsp;&middot;&nbsp; Attempt 2: <strong>' + pct(S.attemptScores[1]) + '</strong>' : '') +
          '</div>' +
          '<div class="aa-final">Your recorded grade: <strong>' + pct(averageScore()) + '</strong>' +
            (S.attemptScores.length > 1 ? ' (average of both attempts)' : '') + '</div>' +
          '<div class="aa-note">You\u2019ve used both attempts for this arena. This score is final.</div>' +
        '</div>';
    } else if (done === 1) {
      // first attempt finished, second offered (optional)
      html =
        '<div class="aa-card aa-between">' +
          '<div class="aa-title">Attempt 1 complete \u2014 you scored <strong>' + pct(S.attemptScores[0]) + '</strong></div>' +
          '<div class="aa-note">You have <strong>one optional second attempt</strong>. Take it <em>only if you want to improve</em> \u2014 ' +
            'if you play again, your grade becomes the <strong>average of both attempts</strong>, not the higher one. ' +
            'If you\u2019re happy with ' + pct(S.attemptScores[0]) + ', you can stop here and that\u2019s your grade.</div>' +
          '<div class="aa-actions">' +
            '<button class="aa-btn aa-btn-primary" id="aa-second">Take second attempt</button> ' +
            '<button class="aa-btn aa-btn-ghost" id="aa-keep">Keep my score &amp; finish</button>' +
          '</div>' +
        '</div>';
    } else if (S.attemptIndex >= 1) {
      // mid-attempt progress
      html =
        '<div class="aa-card aa-progress">' +
          '<div class="aa-title">Attempt ' + S.attemptIndex + ' of ' + S.maxAttempts + '</div>' +
          '<div class="aa-note">Case <strong>' + Math.min(S.answeredThisAttempt + 1, S.caseCount) + '</strong> of ' + S.caseCount +
            '. Answer every case to finish this attempt. You have ' + S.maxAttempts + ' attempts total; the second is optional.</div>' +
        '</div>';
    } else {
      // not started
      html =
        '<div class="aa-card aa-start">' +
          '<div class="aa-title">This arena is graded</div>' +
          '<div class="aa-note">You get <strong>' + S.maxAttempts + ' attempts</strong>, each a full pass through ' + S.caseCount +
            ' cases. The second attempt is optional \u2014 take it only if you want to improve on the first. ' +
            'If you take both, your grade is their <strong>average</strong>.</div>' +
        '</div>';
    }
    el.innerHTML = html;

    var b2 = global.document.getElementById("aa-second");
    if (b2) { b2.onclick = function () { startAttempt(true); }; }
    var bk = global.document.getElementById("aa-keep");
    if (bk) { bk.onclick = function () { S.locked = true; render(); }; }
  }

  function startAttempt(fromUser) {
    if (S.locked) { return; }
    if (S.attemptScores.length >= S.maxAttempts) { S.locked = true; render(); return; }
    S.attemptIndex = S.attemptScores.length + 1;
    S.answeredThisAttempt = 0;
    S.correctThisAttempt = 0;
    render();
    // When the user explicitly starts an attempt (e.g. "Take second attempt"),
    // tell the arena to deal the first case of the fresh attempt.
    if (fromUser && typeof S.onStartAttempt === "function") {
      S.onStartAttempt({ attempt: S.attemptIndex });
    }
  }

  function endAttempt() {
    var frac = S.caseCount > 0 ? (S.correctThisAttempt / S.caseCount) : 0;
    S.attemptScores.push(frac);
    save();

    // Report this completed attempt to the database as a summary row, so the
    // gradebook/My Progress can show per-attempt scores and the average. The
    // per-case rows were already written by recordArenaCase during play.
    var m = mod();
    if (m && m.recordArenaAttempt) {
      m.recordArenaAttempt(S.slug, S.attemptScores.length, frac, averageScore());
    }

    if (S.attemptScores.length >= S.maxAttempts) { S.locked = true; }
    S.attemptIndex = 0;
    if (typeof S.onAttemptEnd === "function") {
      S.onAttemptEnd({ attempt: S.attemptScores.length, score: frac, average: averageScore(), locked: S.locked });
    }
    render();
  }

  // ---- public API ---------------------------------------------------------

  function init(opts) {
    opts = opts || {};
    S.slug = opts.slug;
    S.caseCount = opts.caseCount || 0;
    S.onAttemptEnd = opts.onAttemptEnd || null;
    S.onStartAttempt = opts.onStartAttempt || null;
    S.mountId = opts.mount || null;
    S.recordCase = opts.recordCase || null;
    if (typeof opts.maxAttempts === "number") { S.maxAttempts = opts.maxAttempts; }
    S.attemptIndex = 0;
    S.answeredThisAttempt = 0;
    S.correctThisAttempt = 0;
    S.attemptScores = [];
    S.locked = false;
    load();
    render();
  }

  // Call once per graded case. Returns false and ignores the case if the arena
  // is locked or no attempt is running (the caller can also check isPlayable()).
  function caseAnswered(isCorrect) {
    if (S.locked) { return false; }
    if (S.attemptIndex < 1) { startAttempt(false); }   // count-only; arena already dealt case 1
    S.answeredThisAttempt += 1;
    if (isCorrect) { S.correctThisAttempt += 1; }

    // Recording: if the arena provided its own recordCase (e.g. IMBackend.gradeCase
    // grades AND logs server-side), the arena handles persistence and we do NOT
    // double-write. Only if no recorder was supplied do we fall back to the
    // progress module's per-case writer.
    if (!S.recordCase) {
      var m = mod();
      if (m && m.recordArenaCase) { m.recordArenaCase(S.slug, S.answeredThisAttempt, !!isCorrect); }
    }

    if (S.answeredThisAttempt >= S.caseCount) { endAttempt(); }
    else { render(); }
    return true;
  }

  function isPlayable() { return !S.locked; }
  function isLocked() { return S.locked; }
  function isAttemptActive() { return S.attemptIndex >= 1 && S.answeredThisAttempt < S.caseCount && !S.locked; }
  function casesLeft() { return Math.max(0, S.caseCount - S.answeredThisAttempt); }
  function attemptsTaken() { return S.attemptScores.length; }
  function currentGrade() { return averageScore(); }

  global.ArenaAttempts = {
    init: init,
    caseAnswered: caseAnswered,
    startAttempt: startAttempt,
    isPlayable: isPlayable,
    isLocked: isLocked,
    isAttemptActive: isAttemptActive,
    casesLeft: casesLeft,
    attemptsTaken: attemptsTaken,
    currentGrade: currentGrade,
    render: render
  };
})(window);
