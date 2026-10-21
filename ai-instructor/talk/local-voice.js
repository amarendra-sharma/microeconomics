// local-voice.js - the instructor's voice using ONLY voices that run on the student's own device (speechSynthesis voices whose
// `localService` flag is true). Voices that stream from a vendor's cloud are never selected, so the text being spoken stays on the device.
// It has the same surface the avatar, panel and turn controller already use from InstructorAudio (on, beginTurn, playBuffer, endTurn, stop,
// isSpeaking, setMuted, ...). The browser gives no access to the audio it produces, so the avatar's mouth is driven by a SYNTHETIC loudness
// curve (syllable rhythm plus pulses on word boundaries). That is approximate lip-sync, not phoneme-accurate. Text-only: no model files.

// Novelty / unsuitable macOS voices that a lecturer must never use.
var NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|princess|agnes)\b/i;

export function listLocalEnglishVoices(synth) {
  var vs = [];
  try { vs = synth.getVoices ? synth.getVoices() : []; } catch (e) { vs = []; }
  var out = [];
  for (var i = 0; i < vs.length; i++) {
    var v = vs[i];
    if (v && v.localService === true && /^en([-_]|$)/i.test(v.lang || '') && !NOVELTY.test(v.name || '')) out.push(v);
  }
  return out;
}
function score(v) {
  var s = 0, n = v.name || '';
  if (/premium|enhanced|natural|neural/i.test(n)) s += 4;
  if (/^en[-_]us$/i.test(v.lang || '')) s += 2;
  if (v.default) s += 1;
  return s;
}
export function pickVoice(voices, preferredUri) {
  if (!voices.length) return null;
  if (preferredUri) for (var i = 0; i < voices.length; i++) if (voices[i].voiceURI === preferredUri) return voices[i];
  return voices.slice().sort(function (a, b) { return score(b) - score(a); })[0];
}


// ---- Mouth plan: a rough word/syllable timeline built from the sentence text ---------------------------------------------------------
// The browser gives no audio, so the mouth follows an estimated timeline (about 13 letters per second at rate 1) that is re-aligned to the real
// speech every time the voice reports a word boundary. The mouth closes between words and at punctuation, and each syllable opens by its vowel.
var VOWEL_OPEN = { a: 0.55, o: 0.5, u: 0.3, e: 0.4, i: 0.3, y: 0.3 };
var VOWEL_BRIGHT = { a: 0.5, o: 0.2, u: 0.15, e: 0.8, i: 0.9, y: 0.8 };
function syllableVowels(w) {
  var lw = w.toLowerCase(), g = lw.match(/[aeiouy]+/g) || [];
  if (g.length > 1 && /[^aeiouy]e$/.test(lw) && !/le$/.test(lw)) g.pop();          // silent final e
  if (!g.length) return [/[0-9]/.test(lw) ? 'e' : 'a'];                             // numbers / acronyms: one open syllable
  return g.map(function (x) { return x.charAt(0); });
}
export function planMouth(text, rate) {
  var re = /\S+/g, m, t = 0, words = [], r = rate > 0 ? rate : 1;
  while ((m = re.exec(String(text || ''))) !== null) {
    var raw = m[0], letters = raw.replace(/[^A-Za-z0-9]/g, '');
    if (!letters) { t += 0.15 / r; continue; }
    var v = syllableVowels(letters), dur = Math.max(0.14, letters.length / 13 / r);
    words.push({ from: m.index, to: m.index + raw.length, start: t, dur: dur, v: v });
    t += dur + 0.05 / r + (/[.!?]["')\]]*$/.test(raw) ? 0.35 : /[,;:]["')\]]*$/.test(raw) ? 0.18 : 0);
  }
  return { words: words, total: t };
}
// Mouth openness (0..~0.55) and vowel "brightness" (0..1) at plan-time r seconds.
export function mouthAt(plan, r) {
  var ws = plan.words;
  for (var i = 0; i < ws.length; i++) {
    var w = ws[i];
    if (r < w.start) return { level: 0, bright: 0.5 };
    if (r > w.start + w.dur) continue;
    var p = (r - w.start) / w.dur, n = w.v.length, pos = p * n, k = Math.min(n - 1, Math.floor(pos)), f = pos - k;
    var bump = Math.pow(Math.sin(Math.PI * f), 0.8), edge = Math.min(1, p / 0.18, (1 - p) / 0.18);
    var ch = w.v[k];
    return { level: (VOWEL_OPEN[ch] || 0.4) * (0.3 + 0.7 * bump) * Math.max(0, edge), bright: VOWEL_BRIGHT[ch] || 0.5 };
  }
  return { level: 0, bright: 0.5 };
}

export function LocalVoiceAudio(opts) {
  opts = opts || {};
  this._synth = opts.synth || (typeof window !== 'undefined' ? window.speechSynthesis : null);
  this._Utter = opts.Utterance || (typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null);
  this._now = opts.now || function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; };
  this._setTimeout = opts.setTimeout || function (f, ms) { return setTimeout(f, ms); };
  this._clearTimeout = opts.clearTimeout || function (id) { return clearTimeout(id); };
  this.rate = opts.rate || 1;
  this.voice = null; this._preferred = opts.preferredVoiceUri || null;
  this.ctx = null;                                       // no AudioContext: the browser plays this itself
  this._turn = 0; this._pending = 0; this._speaking = false; this._ending = false; this._muted = false; this._disposed = false;
  this._active = false; this._pulse = 0; this._lastT = 0; this._phase = Math.random() * 6.28; this._turnStart = 0; this._subs = {};
  this._watch = null; this._ready = false;
  var self = this;
  // Synthetic analyser: the avatar reads loudness (RMS * 4) and brightness (spectral centroid) from this.
  this.analyser = {
    fftSize: 1024, frequencyBinCount: 512,
    getFloatTimeDomainData: function (buf) { var a = self._level() / 4 * Math.SQRT2; for (var i = 0; i < buf.length; i++) buf[i] = a * Math.sin(i * 0.3); },
    getByteFrequencyData: function (buf) { for (var i = 0; i < buf.length; i++) buf[i] = 0; var c = Math.max(1, Math.min(buf.length - 1, Math.round((self._bright === undefined ? 0.5 : self._bright) * 128))); buf[c] = self._active ? 200 : 0; },
    disconnect: function () {}
  };
}
LocalVoiceAudio.prototype.on = function (name, fn) {
  (this._subs[name] = this._subs[name] || []).push(fn);
  var self = this; return function () { var a = self._subs[name] || [], i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
};
LocalVoiceAudio.prototype._emit = function (name, arg) {
  var a = (this._subs[name] || []).slice();
  for (var i = 0; i < a.length; i++) { try { a[i](arg); } catch (e) { /* ignore subscriber errors */ } }
};
// Synthetic mouth level, 0..~0.55. Zero unless a sentence is actually being spoken, and zero between words.
LocalVoiceAudio.prototype._level = function () {
  if (!this._active || !this._cur) return 0;
  var c = this._cur, r = this._now() - c.t0 - c.off;
  if (!c.seen && c.plan.total > 0 && r > c.plan.total) r = r % c.plan.total;     // voice reports no boundaries: keep a plausible rhythm until it ends
  var m = mouthAt(c.plan, r);
  this._bright = m.bright;
  return m.level;
};
// Start the mouth plan for the sentence that has just begun, and re-align it when the voice reports a word boundary.
LocalVoiceAudio.prototype._startPlan = function (text) { this._cur = { plan: planMouth(text, this.rate), t0: this._now(), off: 0 }; };
LocalVoiceAudio.prototype._realign = function (charIndex) {
  var c = this._cur; if (!c || typeof charIndex !== 'number') return;
  c.seen = true;
  for (var i = 0; i < c.plan.words.length; i++) {
    var w = c.plan.words[i];
    if (charIndex >= w.from && charIndex < w.to) { c.off = (this._now() - c.t0) - w.start; return; }
  }
};
LocalVoiceAudio.prototype.available = function () { return !!(this._synth && this._Utter && this.voice); };
LocalVoiceAudio.prototype.voices = function () { return this._synth ? listLocalEnglishVoices(this._synth) : []; };
LocalVoiceAudio.prototype.setVoice = function (uri) { this._preferred = uri; this.voice = pickVoice(this.voices(), uri); return this.voice; };
// Must be called from a click/keypress. Voices load asynchronously in some browsers, so wait briefly for them.
LocalVoiceAudio.prototype.unlock = function () {
  var self = this;
  if (!this._synth) return Promise.resolve();
  var find = function () { self.voice = pickVoice(self.voices(), self._preferred); self._ready = true; return self.voice; };
  if (find()) return Promise.resolve();
  return new Promise(function (resolve) {
    var done = false, finish = function () { if (done) return; done = true; try { self._synth.removeEventListener('voiceschanged', onChange); } catch (e) { /* ok */ } find(); resolve(); };
    var onChange = function () { if (self.voices().length) finish(); };
    try { self._synth.addEventListener('voiceschanged', onChange); } catch (e) { /* ok */ }
    self._setTimeout(finish, 1500);
  });
};
LocalVoiceAudio.prototype.beginTurn = function (turnId) { this._turn = turnId; this._ending = false; this._simEnd = 0; };
LocalVoiceAudio.prototype.currentTime = function () { return this._now(); };
LocalVoiceAudio.prototype.turnStartTime = function () { return this._turnStart; };
LocalVoiceAudio.prototype._armWatch = function () {
  var self = this;
  if (this._watch !== null) this._clearTimeout(this._watch);
  // If the browser never starts speaking (voice failed), do not leave the avatar "thinking" forever.
  this._watch = this._setTimeout(function () { self._watch = null; if (!self._speaking && self._pending > 0) { self._pending = 0; try { self._synth.cancel(); } catch (e) { /* ok */ } self._maybeFinish(self._turn, true); } }, 6000);
};
// token: { text } produced by LocalTtsStandIn. Mirrors InstructorAudio.playBuffer.
LocalVoiceAudio.prototype.playBuffer = function (token, turnId, info) {
  if (this._disposed || turnId !== this._turn || !this._synth || !this._Utter || !token || !token.text) return false;
  if (!this.voice) this.voice = pickVoice(this.voices(), this._preferred);
  if (!this.voice) return false;
  var self = this, u = new this._Utter(token.text);
  u.voice = this.voice; u.lang = this.voice.lang; u.rate = this.rate; u.pitch = 1; u.volume = this._muted ? 0 : 1;
  this._pending++;
  if (this._muted) return this._simulate(token.text, turnId, info);   // keep the avatar and timing consistent without sound
  u.onstart = function () {
    if (self._disposed || turnId !== self._turn) return;
    self._active = true; self._lastT = self._now(); self._startPlan(token.text);
    if (info) self._emit('sentence', { turnId: turnId, index: info.index, text: info.text });
    if (self._watch !== null) { self._clearTimeout(self._watch); self._watch = null; }
    if (!self._speaking) { self._speaking = true; self._turnStart = self._now(); self._emit('start', { turnId: turnId, at: self._turnStart }); }
  };
  u.onboundary = function (e) { if (e && (e.name === 'word' || e.name === undefined)) self._realign(e.charIndex); };
  var finish = function () {
    if (turnId !== self._turn) return;                     // a stop() already reset everything
    self._pending = Math.max(0, self._pending - 1); self._active = false;
    self._maybeFinish(turnId, false);
  };
  u.onend = finish;
  u.onerror = function (e) { if (e && (e.error === 'canceled' || e.error === 'interrupted')) return; finish(); };
  try { this._synth.speak(u); } catch (e) { this._pending = Math.max(0, this._pending - 1); return false; }
  if (!this._speaking) this._armWatch();
  return true;
};

// Muted: no sound, but the avatar still "speaks" for a plausible time so captions, states and turn-taking behave the same.
LocalVoiceAudio.prototype._simulate = function (text, turnId, info) {
  var self = this, words = Math.max(1, String(text).trim().split(/\s+/).length), dur = Math.max(0.6, words * 0.33);
  var now = this._now(), start = Math.max(now, this._simEnd || 0); this._simEnd = start + dur;
  var tokenTurn = turnId;
  this._setTimeout(function () {
    if (self._disposed || tokenTurn !== self._turn) return;
    self._active = true; self._lastT = self._now(); self._startPlan(text);
    if (info) self._emit('sentence', { turnId: tokenTurn, index: info.index, text: info.text });
    if (!self._speaking) { self._speaking = true; self._turnStart = self._now(); self._emit('start', { turnId: tokenTurn, at: self._turnStart }); }
  }, Math.max(0, (start - now) * 1000));
  this._setTimeout(function () {
    if (self._disposed || tokenTurn !== self._turn) return;
    self._pending = Math.max(0, self._pending - 1); self._active = false; self._maybeFinish(tokenTurn, false);
  }, Math.max(0, (start + dur - now) * 1000));
  return true;
};
LocalVoiceAudio.prototype.endTurn = function (turnId) {
  if (turnId !== this._turn) return;
  this._ending = true; this._maybeFinish(turnId, true);      // true: also finish a turn where nothing could be spoken (no device voice)
};
LocalVoiceAudio.prototype._maybeFinish = function (turnId, force) {
  if (turnId !== this._turn || !this._ending || this._pending > 0) return;
  var wasSpeaking = this._speaking;
  this._speaking = false; this._ending = false; this._active = false;
  if (wasSpeaking || force) this._emit('end', { turnId: turnId });
};
LocalVoiceAudio.prototype.stop = function () {
  this._turn += 1;                                        // invalidates callbacks of utterances already queued
  var was = this._speaking;
  this._speaking = false; this._ending = false; this._pending = 0; this._active = false; this._pulse = 0;
  if (this._watch !== null) { this._clearTimeout(this._watch); this._watch = null; }
  try { if (this._synth) this._synth.cancel(); } catch (e) { /* ok */ }
  if (was) this._emit('stopped', {});
};
LocalVoiceAudio.prototype.setMuted = function (m) {
  this._muted = !!m;                                      // applies from the next sentence; the sentence being spoken finishes
  this._emit('mute', this._muted);
};
LocalVoiceAudio.prototype.isMuted = function () { return this._muted; };
LocalVoiceAudio.prototype.isSpeaking = function () { return this._speaking; };
LocalVoiceAudio.prototype.dispose = function () {
  if (this._disposed) return;
  this.stop(); this._disposed = true; this._subs = {};
};

// Stand-in with the same shape as TtsClient: nothing to download, "synthesis" just hands the sentence to LocalVoiceAudio.
export var LocalTtsStandIn = {
  ready: true,
  onEvent: function () {},
  load: function () { return Promise.resolve({ loadMs: 0, local: true }); },
  synthesize: function (text) { return Promise.resolve({ text: text }); },
  dispose: function () {}
};
