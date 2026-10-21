// avatar.js - AIInstructorAvatar: orchestrates state, expression, blinking, lip-sync and the render loop.
// All GPU work is delegated to an injected `backend` (see three-deps.js), so this file is testable without WebGL.
//
// Backend interface:
//   init(container)                    -> throws if WebGL is unavailable
//   load(url, onProgress)              -> Promise<{ morphNames: string[] }>
//   setMorphs(weightsByName)           ; setPose({rx,ry,rz,breath}) ; render() ; resize(w,h)
//   setQuality(tier) ; suspend() ; onContextLost(cb) ; dispose()
import { isApprovedModelUrl } from './config.js?v=20261021a';
import { InstructorStateMachine } from './instructor-state.js?v=20261021a';
import { LipSyncController, analyserLevelSource, analyserBrightnessSource } from './lipsync.js?v=20261021a';
import { createBlinkScheduler, ExpressionBlender, STATE_EXPRESSION, idlePose } from './morph-driver.js?v=20261021a';

var CORE_LIP = ['jawOpen'];
var CORE_BLINK = ['eyeBlinkLeft', 'eyeBlinkRight'];

export function AIInstructorAvatar(container, options, backend, env) {
  options = options || {};
  env = env || (typeof window !== 'undefined' ? window : {});
  this.container = container; this.options = options; this.backend = backend; this.env = env;
  this.machine = new InstructorStateMachine('idle');
  this.lipsync = new LipSyncController(options.lipsync);
  this.blink = createBlinkScheduler(options.rng);
  this.expr = new ExpressionBlender();
  this.loadState = 'idle';           // idle | loading | ready | error
  this.loadError = null; this.progress = 0;
  this.capabilities = { lipsync: false, blink: false, morphCount: 0, missing: [] };
  this.quality = 0;                  // 0 full, 1 reduced pixel ratio, 2 throttled, 3 2D fallback
  this.reducedMotion = options.reducedMotion;
  if (this.reducedMotion === undefined) {
    var mq = env.matchMedia ? env.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reducedMotion = !!(mq && mq.matches);
  }
  this._subs = {}; this._disposed = false; this._started = false; this._raf = null; this._time = 0; this._last = 0;
  this._driven = {}; this._audio = null; this._audioUnsubs = []; this._timers = []; this._ro = null;
  this._frames = []; this._slowWindows = 0; this._lastRender = 0; this._paused = false; this._manualExpr = null;
  var self = this;
  this._unsubState = this.machine.subscribe(function (to, from, meta) { self._onState(to, from, meta); });
  this._onVis = function () {
    var hidden = env.document && env.document.hidden;
    if (hidden) self._stopLoop(); else if (self.loadState === 'ready' && !self._disposed) self._startLoop();
  };
  if (env.document && env.document.addEventListener) env.document.addEventListener('visibilitychange', this._onVis);
  this.expr.set(STATE_EXPRESSION.idle, 0.6);
}

AIInstructorAvatar.prototype.on = function (name, fn) {
  (this._subs[name] = this._subs[name] || []).push(fn);
  var self = this; return function () { var a = self._subs[name] || [], i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
};
AIInstructorAvatar.prototype._emit = function (name, arg) {
  var a = (this._subs[name] || []).slice();
  for (var i = 0; i < a.length; i++) { try { a[i](arg); } catch (e) { /* ignore subscriber errors */ } }
};
AIInstructorAvatar.prototype._setLoadState = function (s) { this.loadState = s; this._emit('loadstate', { state: s, progress: this.progress, error: this.loadError }); };

AIInstructorAvatar.prototype._fail = function (code, err) {
  if (this._disposed) return;
  this.loadError = { code: code, message: err && err.message ? err.message : String(err) };
  this._stopLoop();
  try { this.backend.dispose(); } catch (e) { /* release GPU even on failure */ }
  this._setLoadState('error');
  this._emit('error', this.loadError);
  this._emit('fallback', { reason: code });
};

AIInstructorAvatar.prototype.start = function () {
  var self = this;
  if (this._disposed) return Promise.reject(new Error('Avatar is disposed'));
  if (this._started) return Promise.resolve();
  this._started = true;
  var check = isApprovedModelUrl(this.options.modelUrl, { approvedOrigins: this.options.approvedOrigins, allowRelativeDev: this.options.allowRelativeDev });
  if (!check.ok) { this._fail('model-url-blocked', new Error(check.reason)); return Promise.resolve(); }
  this._setLoadState('loading');
  try {
    this.backend.init(this.container);
    if (this.backend.onContextLost) this.backend.onContextLost(function () { self._fail('webgl-context-lost', new Error('The graphics context was lost')); });
  } catch (e) { this._fail('webgl-unavailable', e); return Promise.resolve(); }
  this._watchResize();
  return this.backend.load(this.options.modelUrl, function (p) { self.progress = p; self._emit('progress', p); }).then(function (info) {
    if (self._disposed) { try { self.backend.dispose(); } catch (e) { /* ok */ } return; }
    var names = info && info.morphNames ? info.morphNames : [], set = {}, i, miss = [];
    for (i = 0; i < names.length; i++) set[names[i]] = 1;
    for (i = 0; i < CORE_LIP.length; i++) if (!set[CORE_LIP[i]]) miss.push(CORE_LIP[i]);
    for (i = 0; i < CORE_BLINK.length; i++) if (!set[CORE_BLINK[i]]) miss.push(CORE_BLINK[i]);
    self.capabilities = { lipsync: !!set.jawOpen, blink: !!(set.eyeBlinkLeft && set.eyeBlinkRight), morphCount: names.length, missing: miss };
    self.progress = 1;
    self._setLoadState('ready');
    if (miss.length) self._emit('warning', { code: 'missing-morphs', missing: miss });
    self._startLoop();
  }, function (err) { self._fail('model-load-failed', err); });
};

AIInstructorAvatar.prototype._watchResize = function () {
  var self = this, c = this.container;
  var apply = function () { if (self._disposed) return; var w = c.clientWidth || 0, h = c.clientHeight || 0; if (w > 0 && h > 0) self.backend.resize(w, h); };
  if (this.env.ResizeObserver) { this._ro = new this.env.ResizeObserver(apply); this._ro.observe(c); }
  else if (this.env.addEventListener) { this._winResize = apply; this.env.addEventListener('resize', apply); }
  apply();
};

AIInstructorAvatar.prototype._startLoop = function () {
  if (this._raf !== null || this._disposed || !this.env.requestAnimationFrame) return;
  var self = this; this._last = 0;
  var tick = function (ts) { self._raf = null; if (self._disposed) return; self._raf = self.env.requestAnimationFrame(tick); self._frame(ts); };
  this._raf = this.env.requestAnimationFrame(tick);
};
AIInstructorAvatar.prototype._stopLoop = function () {
  if (this._raf !== null && this.env.cancelAnimationFrame) this.env.cancelAnimationFrame(this._raf);
  this._raf = null;
};

AIInstructorAvatar.prototype._frame = function (tsMs) {
  var dt = this._last ? (tsMs - this._last) / 1000 : 0.016;
  this._last = tsMs;
  if (dt > 0.1) dt = 0.1;
  if (this.quality === 2 && tsMs - this._lastRender < 66) return;       // ~15 fps in throttled tier
  if (this.quality === 3 && tsMs - this._lastRender < 100) return;      // 2D fallback: math only at ~10 Hz
  this._lastRender = tsMs;
  this._time += dt;
  this._trackPerformance(dt);

  var audioClock = this._audio ? this._audio.currentTime() : this._time;
  var lip = this.lipsync.update(dt, audioClock);
  var blink = this.capabilities.blink ? this.blink.update(dt) : 0;
  var ex = this.expr.update(dt), w = {}, n;
  for (n in ex) w[n] = ex[n];
  for (n in lip) w[n] = Math.min(1, (w[n] || 0) + lip[n]);
  if (blink > 0) { w.eyeBlinkLeft = Math.max(w.eyeBlinkLeft || 0, blink); w.eyeBlinkRight = Math.max(w.eyeBlinkRight || 0, blink); }
  for (n in w) this._driven[n] = 1;
  for (n in this._driven) if (w[n] === undefined) w[n] = 0;               // release names no longer driven
  var pose = idlePose(this._time, this.machine.state, this.lipsync.level, this.reducedMotion);

  if (this.quality >= 3) { this._emit('fallbacklevel', { level: this.lipsync.level, state: this.machine.state }); return; }
  this.backend.setMorphs(w); this.backend.setPose(pose); this.backend.render();
};

// If frames are consistently slow, step down quality instead of stuttering.
AIInstructorAvatar.prototype._trackPerformance = function (dt) {
  if (this.options.adaptiveQuality === false) return;
  this._frames.push(dt);
  if (this._frames.length < 90) return;
  var sum = 0; for (var i = 0; i < this._frames.length; i++) sum += this._frames[i];
  var fps = this._frames.length / sum; this._frames = [];
  var floor = this.quality === 2 ? 12 : 24;                               // throttled tier targets ~15 fps, so only a collapse below 12 escalates
  if (fps < floor) { this._slowWindows += 1; if (this._slowWindows >= 2) { this._slowWindows = 0; this.setQuality(this.quality + 1); } }
  else this._slowWindows = 0;
};
AIInstructorAvatar.prototype.setQuality = function (tier) {
  tier = Math.max(0, Math.min(3, tier | 0));
  if (tier === this.quality) return;
  this.quality = tier;
  if (this.backend.setQuality) this.backend.setQuality(tier);
  if (tier === 3 && this.backend.suspend) this.backend.suspend();
  this._emit('quality', { tier: tier });
  if (tier === 3) this._emit('fallback', { reason: 'low-performance' });
};

// ---- conversation state -------------------------------------------------------------------
AIInstructorAvatar.prototype._onState = function (to, from, meta) {
  if (this._manualExpr === null) this.expr.set(STATE_EXPRESSION[to] || 'neutral', to === 'idle' ? 0.6 : 0.9);
  if (to !== 'speaking' && to !== 'interrupted' && !this._audioSpeaking()) this.lipsync.stop();
  this._emit('state', { state: to, from: from, meta: meta });
};
AIInstructorAvatar.prototype._audioSpeaking = function () { return !!(this._audio && this._audio.isSpeaking()); };
AIInstructorAvatar.prototype.setState = function (to, meta) { return this.machine.transition(to, meta); };
AIInstructorAvatar.prototype.setExpression = function (name, intensity) {
  if (name === null || name === undefined || name === 'auto') { this._manualExpr = null; this.expr.set(STATE_EXPRESSION[this.machine.state] || 'neutral', 0.9); return; }
  this._manualExpr = name; this.expr.set(name, intensity);
};

// Connect the audio player: the avatar speaks exactly when audio is actually playing.
AIInstructorAvatar.prototype.attachAudio = function (audio) {
  var self = this; this.detachAudio(); this._audio = audio;
  this._audioUnsubs.push(audio.on('start', function () {
    if (self._disposed) return;
    if (self.machine.state === 'interrupted') return;                    // never resume speaking after an interrupt
    if (self.machine.state !== 'speaking') self.machine.transition('speaking');
    if (self.lipsync.mode !== 'timed-visemes' && audio.analyser) self.lipsync.useEnvelope(analyserLevelSource(audio.analyser), analyserBrightnessSource(audio.analyser));
  }));
  this._audioUnsubs.push(audio.on('end', function () { if (!self._disposed) { self.lipsync.stop(); self.machine.transition('idle'); } }));
  this._audioUnsubs.push(audio.on('stopped', function () { if (!self._disposed) self.lipsync.stop(); }));
};
AIInstructorAvatar.prototype.detachAudio = function () {
  for (var i = 0; i < this._audioUnsubs.length; i++) this._audioUnsubs[i]();
  this._audioUnsubs = []; this._audio = null;
};
// Use timed visemes (phoneme-level) instead of the loudness envelope for the current utterance.
AIInstructorAvatar.prototype.useVisemeTrack = function (events) {
  this.lipsync.useVisemes(events, this._audio ? this._audio.turnStartTime() : this._time);
};

// Student interrupts: cut audio and animation immediately, then become attentive again.
AIInstructorAvatar.prototype.interrupt = function () {
  if (this._disposed) return;
  if (this._audio) this._audio.stop();
  this.lipsync.stop();
  this.machine.interrupt();
  var self = this, set = this.env.setTimeout || setTimeout;
  var t = set(function () { if (!self._disposed && self.machine.state === 'interrupted') self.machine.transition('listening'); }, 400);   // only if nothing newer has started
  this._timers.push(t);
};

AIInstructorAvatar.prototype.dispose = function () {
  if (this._disposed) return;
  this._disposed = true;
  this._stopLoop();
  var clear = this.env.clearTimeout || clearTimeout;
  for (var i = 0; i < this._timers.length; i++) clear(this._timers[i]);
  this._timers = [];
  this.detachAudio();
  if (this._unsubState) this._unsubState();
  if (this._ro) { this._ro.disconnect(); this._ro = null; }
  if (this._winResize && this.env.removeEventListener) this.env.removeEventListener('resize', this._winResize);
  if (this.env.document && this.env.document.removeEventListener) this.env.document.removeEventListener('visibilitychange', this._onVis);
  this.lipsync.reset();
  try { this.backend.dispose(); } catch (e) { /* ignore */ }
  this._subs = {};
};
