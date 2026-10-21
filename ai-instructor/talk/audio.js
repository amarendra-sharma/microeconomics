// audio.js - playback of the instructor's voice with strict turn handling and full cleanup.
// Chunks are scheduled gap-free on the WebAudio clock. A chunk from an old turn is refused, so an
// interrupted answer can never start playing after the student has moved on.
//
// Graph:  source -> analyser (lip-sync tap, always live, even when muted)
//         source -> turnGain -> masterGain (mute) -> destination
export function InstructorAudio(opts) {
  opts = opts || {};
  this._createContext = opts.createContext || function () { var C = window.AudioContext || window.webkitAudioContext; return new C(); };
  // Wrapped so the browser's global functions are never invoked with `this` = this object ("Illegal invocation").
  this._setTimeout = opts.setTimeout || function (f, ms) { return setTimeout(f, ms); };
  this._clearTimeout = opts.clearTimeout || function (id) { return clearTimeout(id); };
  this.fadeSeconds = opts.fadeSeconds === undefined ? 0.03 : opts.fadeSeconds;
  this.ctx = null; this.analyser = null; this._master = null; this._turnGain = null;
  this._sources = []; this._turn = 0; this._nextTime = 0; this._muted = false; this._speaking = false;
  this._ending = false; this._disposed = false; this._timers = []; this._subs = {};
  this._turnStart = 0;
}
InstructorAudio.prototype.on = function (name, fn) {
  (this._subs[name] = this._subs[name] || []).push(fn);
  var self = this; return function () { var a = self._subs[name] || [], i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
};
InstructorAudio.prototype._emit = function (name, arg) {
  var a = (this._subs[name] || []).slice();
  for (var i = 0; i < a.length; i++) { try { a[i](arg); } catch (e) { /* ignore subscriber errors */ } }
};
InstructorAudio.prototype._ensure = function () {
  if (this._disposed) throw new Error('InstructorAudio is disposed');
  if (this.ctx) return;
  this.ctx = this._createContext();
  this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.4;
  this._master = this.ctx.createGain(); this._master.gain.value = this._muted ? 0 : 1;
  this._master.connect(this.ctx.destination);
  this._newTurnGain();
};
InstructorAudio.prototype._newTurnGain = function () {
  this._turnGain = this.ctx.createGain(); this._turnGain.gain.value = 1; this._turnGain.connect(this._master);
};
// Browsers require a user gesture before audio plays; call this from a click/keypress handler.
InstructorAudio.prototype.unlock = function () {
  this._ensure();
  return this.ctx.state === 'suspended' && this.ctx.resume ? this.ctx.resume() : Promise.resolve();
};
InstructorAudio.prototype.beginTurn = function (turnId) {
  this._turn = turnId; this._ending = false; this._nextTime = 0;
};
InstructorAudio.prototype.currentTime = function () { return this.ctx ? this.ctx.currentTime : 0; };
// Returns the audio-clock time at which this turn's audio started (for viseme tracks).
InstructorAudio.prototype.turnStartTime = function () { return this._turnStart; };
InstructorAudio.prototype.playBuffer = function (audioBuffer, turnId, info) {
  if (this._disposed || turnId !== this._turn) return false;          // stale: drop silently
  this._ensure();
  var self = this, src = this.ctx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(this.analyser); src.connect(this._turnGain);
  var now = this.ctx.currentTime, start = Math.max(now + 0.02, this._nextTime);
  if (!this._speaking) { this._speaking = true; this._turnStart = start; this._emit('start', { turnId: turnId, at: start }); }
  src.start(start);
  if (info) {                                         // tell listeners (the whiteboard) the moment this sentence becomes audible
    var delayMs = Math.max(0, (start - this.ctx.currentTime) * 1000), t = this._setTimeout(function () { if (!self._disposed && turnId === self._turn) self._emit('sentence', { turnId: turnId, index: info.index, text: info.text }); }, delayMs);
    this._timers.push(t);
  }
  this._nextTime = start + audioBuffer.duration;
  this._sources.push(src);
  src.onended = function () {
    var i = self._sources.indexOf(src); if (i >= 0) self._sources.splice(i, 1);
    try { src.disconnect(); } catch (e) { /* already disconnected */ }
    self._maybeFinish(turnId);
  };
  return true;
};
// Tell the player no more chunks will arrive for this turn; 'end' fires when the last one finishes.
InstructorAudio.prototype.endTurn = function (turnId) {
  if (turnId !== this._turn) return;
  this._ending = true; this._maybeFinish(turnId);
};
InstructorAudio.prototype._maybeFinish = function (turnId) {
  if (turnId !== this._turn || !this._speaking || !this._ending || this._sources.length > 0) return;
  this._speaking = false; this._ending = false;
  this._emit('end', { turnId: turnId });
};
// Immediately silence and discard everything (student interrupted). Safe to call repeatedly.
InstructorAudio.prototype.stop = function () {
  this._turn += 1;                                                    // invalidates in-flight chunks
  var wasSpeaking = this._speaking;
  this._speaking = false; this._ending = false; this._nextTime = 0;
  if (this.ctx && this._turnGain) {
    var g = this._turnGain, srcs = this._sources.slice(), ctx = this.ctx, self = this;
    this._sources = [];
    try { g.gain.cancelScheduledValues(ctx.currentTime); g.gain.setValueAtTime(g.gain.value, ctx.currentTime); g.gain.linearRampToValueAtTime(0, ctx.currentTime + this.fadeSeconds); } catch (e) { g.gain.value = 0; }
    var t = this._setTimeout(function () {
      for (var i = 0; i < srcs.length; i++) { try { srcs[i].onended = null; srcs[i].stop(); srcs[i].disconnect(); } catch (e) { /* ended */ } }
      try { g.disconnect(); } catch (e2) { /* ok */ }
      var k = self._timers.indexOf(t); if (k >= 0) self._timers.splice(k, 1);
    }, Math.round(this.fadeSeconds * 1000) + 5);
    this._timers.push(t);
    this._newTurnGain();                                              // fresh gain for the next turn
  }
  if (wasSpeaking) this._emit('stopped', {});
};
InstructorAudio.prototype.setMuted = function (m) {
  this._muted = !!m;
  if (this._master) this._master.gain.value = this._muted ? 0 : 1;
  this._emit('mute', this._muted);
};
InstructorAudio.prototype.isMuted = function () { return this._muted; };
InstructorAudio.prototype.isSpeaking = function () { return this._speaking; };
InstructorAudio.prototype.dispose = function () {
  if (this._disposed) return;
  this.stop();
  this._disposed = true;
  for (var i = 0; i < this._timers.length; i++) this._clearTimeout(this._timers[i]);
  this._timers = [];
  for (var j = 0; j < this._sources.length; j++) { try { this._sources[j].onended = null; this._sources[j].stop(); this._sources[j].disconnect(); } catch (e) { /* ok */ } }
  this._sources = [];
  try { if (this._turnGain) this._turnGain.disconnect(); if (this._master) this._master.disconnect(); if (this.analyser) this.analyser.disconnect(); } catch (e2) { /* ok */ }
  if (this.ctx && this.ctx.close) { try { this.ctx.close(); } catch (e3) { /* ok */ } }
  this.ctx = null; this.analyser = null; this._subs = {};
};
