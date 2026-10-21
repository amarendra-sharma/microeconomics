// lipsync.js - independent lip-sync controller. Knows nothing about three.js or the DOM.
//
// Two honest modes:
//   'timed-visemes'      : viseme events with timestamps (from a TTS engine that supplies them). Phoneme-level.
//   'approximate-envelope': mouth opening from audio loudness (+ a rough brightness cue). NOT phoneme-accurate.
// `accuracy` reports which one is active so the UI never overstates what is happening.
//
// update(dt, clock) returns a weights object {morphName: 0..1}. `clock` is the audio clock in seconds
// (AudioContext.currentTime) so animation follows the audio actually being played.

export var VISEMES = ['viseme_sil','viseme_PP','viseme_FF','viseme_TH','viseme_DD','viseme_kk','viseme_CH','viseme_SS','viseme_nn','viseme_RR','viseme_aa','viseme_E','viseme_I','viseme_O','viseme_U'];
// How far the jaw should open for each viseme (0..1) - used when only ARKit-style jaw/mouth shapes exist.
var OPENNESS = { viseme_sil: 0, viseme_PP: 0, viseme_FF: 0.12, viseme_TH: 0.2, viseme_DD: 0.3, viseme_kk: 0.3, viseme_CH: 0.3, viseme_SS: 0.15, viseme_nn: 0.2, viseme_RR: 0.25, viseme_aa: 0.85, viseme_E: 0.45, viseme_I: 0.35, viseme_O: 0.6, viseme_U: 0.3 };
var ROUND = { viseme_O: 0.7, viseme_U: 1, viseme_CH: 0.5, viseme_RR: 0.4 };
var WIDE = { viseme_E: 0.5, viseme_I: 0.6, viseme_SS: 0.4 };

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

export function LipSyncController(opts) {
  opts = opts || {};
  this.jawMax = opts.jawMax === undefined ? 0.85 : opts.jawMax;     // natural limit: never fully gape
  this.maxRate = opts.maxRate === undefined ? 10 : opts.maxRate;    // max weight change per second
  this.attackTau = opts.attackTau === undefined ? 0.045 : opts.attackTau;
  this.releaseTau = opts.releaseTau === undefined ? 0.09 : opts.releaseTau;
  this.lookahead = opts.lookahead === undefined ? 0.03 : opts.lookahead; // anticipate the sound by ~30 ms
  this.gate = opts.gate === undefined ? 0.02 : opts.gate;
  this.mode = 'off';
  this._level = null; this._bright = null;
  this._events = []; this._t0 = 0;
  this._cur = {};          // smoothed output weights
  this._env = 0;           // smoothed envelope
  this.level = 0;          // last output openness (0..1), handy for head nods / fallback UI
}
Object.defineProperty(LipSyncController.prototype, 'accuracy', {
  get: function () { return this.mode === 'timed-visemes' ? 'timed-visemes' : (this.mode === 'envelope' ? 'approximate-envelope' : 'none'); }
});

// levelFn() -> loudness 0..1 ; brightFn() -> optional 0..1 (high = bright/sibilant/front vowels)
LipSyncController.prototype.useEnvelope = function (levelFn, brightFn) {
  this.mode = 'envelope'; this._level = levelFn; this._bright = brightFn || null; this._events = [];
};
// events: [{time, viseme, duration, weight}] with `time` relative to the audio start; t0 = audio clock at start.
LipSyncController.prototype.useVisemes = function (events, t0) {
  var list = [];
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    if (VISEMES.indexOf(e.viseme) < 0 || typeof e.time !== 'number') continue;
    list.push({ time: e.time, end: e.time + (e.duration > 0 ? e.duration : 0.08), viseme: e.viseme, weight: e.weight === undefined ? 1 : clamp(e.weight, 0, 1) });
  }
  list.sort(function (a, b) { return a.time - b.time; });
  this.mode = 'timed-visemes'; this._events = list; this._t0 = t0 || 0; this._level = null; this._bright = null;
};
LipSyncController.prototype.stop = function () { this.mode = 'off'; this._level = null; this._events = []; };
LipSyncController.prototype.reset = function () { this.stop(); this._cur = {}; this._env = 0; this.level = 0; };

LipSyncController.prototype._targets = function (clock) {
  var tg = {}, i, k;
  if (this.mode === 'timed-visemes') {
    var t = clock - this._t0 + this.lookahead, sum = 0, jaw = 0, round = 0, wide = 0;
    for (i = 0; i < this._events.length; i++) {
      var e = this._events[i];
      if (e.time > t) break;
      if (t <= e.end) {
        // smooth in/out within the event so adjacent visemes overlap (coarticulation)
        var inRamp = clamp((t - e.time) / 0.04, 0, 1), outRamp = clamp((e.end - t) / 0.05, 0, 1);
        var w = e.weight * Math.min(inRamp, outRamp + 0.35);
        tg[e.viseme] = Math.max(tg[e.viseme] || 0, clamp(w, 0, 1));
      }
    }
    for (k in tg) sum += tg[k];
    if (sum > 1) for (k in tg) tg[k] /= sum;                       // keep total mouth shape bounded
    for (k in tg) { jaw = Math.max(jaw, (OPENNESS[k] || 0) * tg[k]); round += (ROUND[k] || 0) * tg[k]; wide += (WIDE[k] || 0) * tg[k]; }
    tg.jawOpen = jaw * this.jawMax; tg.mouthFunnel = clamp(round, 0, 1) * 0.6; tg.mouthPucker = clamp(round, 0, 1) * 0.5;
    tg.mouthStretchLeft = clamp(wide, 0, 1) * 0.5; tg.mouthStretchRight = clamp(wide, 0, 1) * 0.5;
    return tg;
  }
  if (this.mode === 'envelope' && this._level) {
    var raw = clamp(this._level(), 0, 1);
    var v = raw < this.gate ? 0 : clamp((raw - this.gate) / 0.5, 0, 1);
    v = Math.pow(v, 0.7);
    var bright = this._bright ? clamp(this._bright(), 0, 1) : 0.5;
    // Loud + dark -> rounded vowel ("oh"/"oo"); loud + bright -> spread ("ee"). Rough cue only.
    tg.jawOpen = v * this.jawMax;
    tg.mouthFunnel = v * (1 - bright) * 0.45; tg.mouthPucker = v * (1 - bright) * 0.25;
    tg.mouthStretchLeft = v * bright * 0.35; tg.mouthStretchRight = v * bright * 0.35;
    tg.viseme_aa = v * (1 - Math.abs(bright - 0.5) * 2) * 0.6;
    tg.viseme_O = v * (1 - bright) * 0.5; tg.viseme_E = v * bright * 0.5;
  }
  return tg;
};

LipSyncController.prototype.update = function (dt, clock) {
  if (!(dt > 0)) dt = 0.016;
  if (dt > 0.1) dt = 0.1;                                          // tab was throttled; do not jump
  var tg = this._targets(clock), names = {}, n, out = {};
  for (n in this._cur) names[n] = 1;
  for (n in tg) names[n] = 1;
  var maxStep = this.maxRate * dt;
  for (n in names) {
    var cur = this._cur[n] || 0, target = tg[n] || 0;
    var tau = target > cur ? this.attackTau : this.releaseTau;
    var next = cur + (target - cur) * (1 - Math.exp(-dt / tau));
    var step = next - cur;                                          // rate limit => never robotic snaps
    if (step > maxStep) next = cur + maxStep; else if (step < -maxStep) next = cur - maxStep;
    next = clamp(next, 0, 1);
    if (next < 0.002 && target === 0) { delete this._cur[n]; continue; }
    this._cur[n] = next; out[n] = next;
  }
  // Different attack/release rates can make blended visemes sum slightly above 1; renormalise so the mouth shape stays bounded.
  var vs = 0, key;
  for (key in out) if (key.indexOf('viseme_') === 0) vs += out[key];
  if (vs > 1) for (key in out) if (key.indexOf('viseme_') === 0) { out[key] /= vs; this._cur[key] = out[key]; }
  this.level = clamp((out.jawOpen || 0) / (this.jawMax || 1), 0, 1);
  return out;
};

// Helpers that turn a WebAudio AnalyserNode into level/brightness callbacks.
export function analyserLevelSource(analyser) {
  var buf = new Float32Array(analyser.fftSize);
  return function () {
    analyser.getFloatTimeDomainData(buf);
    var s = 0; for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length) * 4;                           // speech RMS is small; scale to ~0..1
  };
}
export function analyserBrightnessSource(analyser) {
  var buf = new Uint8Array(analyser.frequencyBinCount);
  return function () {
    analyser.getByteFrequencyData(buf);
    var num = 0, den = 0;
    for (var i = 1; i < buf.length; i++) { num += i * buf[i]; den += buf[i]; }
    if (den === 0) return 0.5;
    return clamp((num / den) / (buf.length * 0.25), 0, 1);          // spectral centroid, normalised
  };
}
