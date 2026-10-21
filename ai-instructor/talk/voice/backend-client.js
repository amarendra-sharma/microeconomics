// backend-client.js - streams a tutoring turn from the it-ai-instructor edge function. Drop-in for ScriptedBackend:
//   backend.respond({ text, turnId, signal }) -> AsyncIterable<string>
// No API key ever lives here: the browser sends only the student's Supabase access token; the function holds the Claude key.
// Safety rules implemented below:
//  * every turn carries a client_turn_id; the server refuses a repeat, so a retry can never create a second user turn;
//  * we retry only when the request provably never produced a reply (network failure before the "accepted" event);
//  * if the server says the turn already exists ("duplicate"/"in_progress") we recover the stored reply from history;
//  * one automatic, jittered retry when the service says "busy, try in N seconds" before any answer text was produced (spreads load after a
//    synchronized rush instead of hammering; refused-before-reservation errors reuse the turn id, provider errors get a fresh one);
//  * aborting (barge-in) cancels the HTTP stream AND tells the server so the stored reply is trimmed to what was heard.
function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  var b = new Uint8Array(16); crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

const REUSE_ID = { busy: 1, rate_limited: 1 }, FRESH_ID = { provider_busy: 1, provider_unavailable: 1, timeout: 1 };
export class BackendError extends Error {
  constructor(body) { super(body.message || body.error); this.name = 'BackendError'; this.code = body.error; this.retryable = !!body.retryable; this.retryAfterS = body.retry_after_s; }
}

// Incremental Server-Sent-Events parser: feed text chunks, get {event, data} objects. Handles CRLF, split chunks, comments.
export class SseParser {
  constructor() { this.buf = ''; }
  push(chunk) {
    this.buf += chunk.replace(/\r\n?/g, '\n'); var out = [], i;
    while ((i = this.buf.indexOf('\n\n')) >= 0) {
      var block = this.buf.slice(0, i); this.buf = this.buf.slice(i + 2);
      var ev = 'message', data = [];
      block.split('\n').forEach(function (line) {
        if (!line || line[0] === ':') return;
        var c = line.indexOf(':'), f = c < 0 ? line : line.slice(0, c), v = c < 0 ? '' : line.slice(c + 1).replace(/^ /, '');
        if (f === 'event') ev = v; else if (f === 'data') data.push(v);
      });
      if (!data.length) continue;
      try { out.push({ event: ev, data: JSON.parse(data.join('\n')) }); } catch (e) { /* ignore a malformed frame */ }
    }
    return out;
  }
}

export class AiInstructorBackend {
  // opts: { url, getToken: async () => accessToken, courseId, fetch?, context?: () => ({chapter, view, topic}), onSession?, inputMode? }
  constructor(opts) {
    this.url = opts.url; this.getToken = opts.getToken; this.courseId = opts.courseId;
    this.fetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    this.context = opts.context || null; this.onSession = opts.onSession || function () {}; this.onVisual = opts.onVisual || function () {};
    this.sessionId = null; this.retentionDays = null; this.lastSeq = 0; this.activeTurn = null;
  }
  async _post(body, signal) {
    var token = await this.getToken();
    return this.fetch(this.url, { method: 'POST', signal: signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  }
  async _json(body, signal) {
    var r = await this._post(body, signal), j = null;
    try { j = await r.json(); } catch (e) { /* non-JSON error page */ }
    if (!r.ok) throw new BackendError(j && j.error ? j : { error: 'internal', message: 'Request failed (' + r.status + ').', retryable: r.status >= 500 });
    return j;
  }
  /** One non-streaming action (for example review_status). Throws BackendError with the server's message. */
  async call(body, signal) { return this._json(body, signal); }
  async startSession() {
    if (this.sessionId) return this.sessionId;
    var j = await this._json({ action: 'start_session', course_id: this.courseId, context: this.context ? this.context() : undefined });
    this.sessionId = j.session_id; this.retentionDays = j.retention_days; this.limits = j.limits; this.onSession(j);
    return this.sessionId;
  }
  // Controlled waiting room: when the service is at capacity, retry with the server's own (jittered) delay, tell the UI, and give up after maxWaitS.
  // opts: { onWait({attempt, retryAfterS, textOnlyAvailable}), maxWaitS: 180, signal }. Throws BackendError('capacity') when the wait budget is spent.
  async startSessionWaiting(opts) {
    opts = opts || {}; var waited = 0, attempt = 0, max = opts.maxWaitS || 180;
    for (;;) {
      try { return await this.startSession(); }
      catch (e) {
        if (!(e instanceof BackendError) || (e.code !== 'capacity' && e.code !== 'paused') || waited >= max) throw e;
        var d = Math.max(opts.minDelayS === undefined ? 5 : opts.minDelayS, e.retryAfterS === undefined ? 15 : e.retryAfterS); waited += d; attempt++;
        if (opts.onWait) opts.onWait({ attempt: attempt, retryAfterS: d, paused: e.code === 'paused', textOnlyAvailable: true });
        await new Promise(function (res) { var t = setTimeout(res, d * 1000 + Math.random() * (opts.jitterMs === undefined ? 2000 : opts.jitterMs)); if (opts.signal) opts.signal.addEventListener('abort', function () { clearTimeout(t); res(); }, { once: true }); });
        if (opts.signal && opts.signal.aborted) throw e;
      }
    }
  }
  async interrupt(turnId, spokenChars) {
    if (!this.sessionId) return false;
    try { var body = { action: 'interrupt', session_id: this.sessionId, client_turn_id: turnId }; if (spokenChars >= 0) body.spoken_chars = Math.floor(spokenChars); return (await this._json(body)).interrupted; }
    catch (e) { return false; }       // best effort: the server also notices the dropped stream
  }
  // Tell the server how much of the last reply was actually spoken (after barge-in) so the stored transcript matches what was heard.
  reportSpoken(spokenChars) { return this.activeTurn ? this.interrupt(this.activeTurn, spokenChars) : Promise.resolve(false); }
  // Aggregate, browser-measured numbers for metering and dashboards (durations and counts only, never audio). Call a few times per session
  // (e.g. after each turn is spoken, and at the end), with DELTAS since the last call. Best effort: failures are ignored.
  reportUsage(m) {
    if (!this.sessionId) return Promise.resolve(false);
    var b = { action: 'report_usage', session_id: this.sessionId }, k;
    for (k in m) if (Object.prototype.hasOwnProperty.call(m, k) && m[k] !== undefined && m[k] !== null) b[k] = typeof m[k] === 'boolean' ? m[k] : Math.max(0, Math.round(m[k]));
    return this._json(b).then(function (j) { return !!j.stored; }, function () { return false; });
  }
  // ---- learning records (the student's own; ungraded) ----
  /** rating: 'helpful' | 'not_helpful'. The student chooses to send it; reason is one of too_hard, too_easy, incorrect, unclear, off_topic, other (never free text). */
  feedback(turnId, rating, reason) { return this.sessionId ? this._json({ action: 'feedback', session_id: this.sessionId, turn_id: turnId || null, rating: rating, reason: reason || null }) : Promise.resolve({ stored: false }); }
  myLearning() { return this._json({ action: 'my_learning', course_id: this.courseId }); }
  deleteMyLearning() { return this._json({ action: 'delete_my_learning', course_id: this.courseId, confirm: true }); }
  clientState(state) { return this.sessionId ? this._json({ action: 'client_state', session_id: this.sessionId, state: state }).catch(function () {}) : Promise.resolve(); }
  async endSession() { if (!this.sessionId) return; var id = this.sessionId; this.sessionId = null; try { await this._json({ action: 'end_session', session_id: id }); } catch (e) { /* ignore */ } }

  async _recover(turnId, signal) {      // the server already has this turn: fetch the reply it stored
    for (var i = 0; i < 6; i++) {
      var h = await this._json({ action: 'history', session_id: this.sessionId, after_seq: 0 }, signal);
      var m = (h.messages || []).filter(function (x) { return x.role === 'assistant' && x.turn_id; });
      if (m.length && h.state !== 'processing' && h.state !== 'generating') return m[m.length - 1].text;
      await new Promise(function (r) { setTimeout(r, 700); });
      if (signal && signal.aborted) return '';
    }
    return '';
  }

  async *respond(req) {
    var signal = req.signal, turnId = uuid(); this.activeTurn = turnId;
    await this.startSession();
    var accepted = false, finished = false, attempt = 0, onAbort = null, yielded = false, autoRetried = false, self = this;
    var ac = new AbortController();
    if (signal) { if (signal.aborted) return; onAbort = function () { ac.abort(); }; signal.addEventListener('abort', onAbort, { once: true }); }
    try {
      for (;;) {
        attempt++;
        try {
          var resp = await this._post({ action: 'turn', session_id: this.sessionId, client_turn_id: turnId, text: req.text, input_mode: req.inputMode || 'voice', mode: req.mode || undefined, context: this.context ? this.context() : undefined }, ac.signal);
          if (!resp.ok) {
            var j = null; try { j = await resp.json(); } catch (e) { /* ignore */ }
            var body = j && j.error ? j : { error: 'internal', message: 'Request failed (' + resp.status + ').', retryable: resp.status >= 500 };
            if (attempt > 1 && (body.error === 'duplicate' || body.error === 'in_progress')) { var t = await this._recover(turnId, ac.signal); if (t) yield t; finished = true; return; }
            throw new BackendError(body);
          }
          var reader = resp.body.getReader(), dec = new TextDecoder(), p = new SseParser();
          for (;;) {
            var r = await reader.read(); if (r.done) break;
            var evs = p.push(dec.decode(r.value, { stream: true }));
            for (var k = 0; k < evs.length; k++) {
              var e = evs[k];
              if (e.event === 'accepted') accepted = true;
              else if (e.event === 'delta') { yielded = true; yield e.data.text; }
              else if (e.event === 'visual') { try { self.onVisual(e.data); } catch (err) { /* a drawing problem must never break the spoken answer */ } }
              else if (e.event === 'error') throw new BackendError(e.data);
              else if (e.event === 'done') { finished = true; return; }
            }
          }
          if (!finished) throw new BackendError({ error: 'provider_unavailable', message: 'The connection dropped.', retryable: accepted ? false : true });
          return;
        } catch (e) {
          if (ac.signal.aborted) return;
          var net = !(e instanceof BackendError);
          if (!net && !yielded && !autoRetried && e.retryable && (REUSE_ID[e.code] || FRESH_ID[e.code]) && (e.retryAfterS || 2) <= 15) {
            autoRetried = true; accepted = false; attempt = 0;
            await new Promise(function (res) { var t = setTimeout(res, (e.retryAfterS || 2) * 1000 + Math.random() * 1000); ac.signal.addEventListener('abort', function () { clearTimeout(t); res(); }, { once: true }); });
            if (ac.signal.aborted) return;
            if (FRESH_ID[e.code]) { turnId = uuid(); self.activeTurn = turnId; }
            continue;
          }
          // Safe to retry only if nothing was accepted and the failure was a transport error; the same turn id makes it idempotent.
          if (net && !accepted && attempt < 2) { await new Promise(function (res) { setTimeout(res, 400 + Math.random() * 400); }); continue; }
          throw net ? new BackendError({ error: 'provider_unavailable', message: 'Could not reach the instructor service.', retryable: !accepted }) : e;
        }
      }
    } finally {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      if (signal && signal.aborted && !finished) { this.interrupt(turnId, -1); }   // barge-in: tell the server (spoken_chars via reportSpoken)
    }
  }
}
