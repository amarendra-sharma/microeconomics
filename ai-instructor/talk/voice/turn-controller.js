// turn-controller.js - one conversational turn: student speech -> ASR -> backend (streamed) -> TTS -> playback.
// Every async step re-checks that its turn is still current, so an interruption can never let an old answer
// start playing. All dependencies are injected: ASR/TTS clients, the backend, the audio player, the state machine.
import { SentenceSplitter, toSpeakable, isLikelyNoise } from './text-prep.js?v=20261021a';
import { TurnMetrics } from './metrics.js?v=20261021a';

export class VoiceTurnController {
  constructor(deps) {
    this.state = deps.state; this.audio = deps.audio; this.asr = deps.asr; this.tts = deps.tts; this.backend = deps.backend;
    this.glossary = deps.glossary || null;
    this.toAudioBuffer = deps.toAudioBuffer;                      // ({samples, sampleRate}) -> AudioBuffer
    this.metrics = deps.metrics || new TurnMetrics(deps.now);
    this.now = deps.now || function () { return performance.now(); };
    this.maxQueued = deps.maxQueuedSentences || 8;
    this._subs = {}; this._abort = null; this._disposed = false; this._active = null;
    var self = this;
    this._offAudio = [];
    if (this.audio && this.audio.on) {
      this._offAudio.push(this.audio.on('start', function (e) { if (self.state.isCurrent(e.turnId)) { self.metrics.mark(e.turnId, 'audioStart'); self.state.transition('speaking'); } }));
      this._offAudio.push(this.audio.on('end', function (e) { if (self.state.isCurrent(e.turnId)) { self.metrics.mark(e.turnId, 'turnEnd'); self._emit('turn-complete', { turnId: e.turnId, metrics: self.metrics.summary(e.turnId) }); self.state.transition('idle'); } }));
    }
  }
  on(name, fn) { (this._subs[name] = this._subs[name] || []).push(fn); }
  _emit(name, arg) { var a = (this._subs[name] || []).slice(); for (var i = 0; i < a.length; i++) { try { a[i](arg); } catch (e) { /* ignore */ } } }

  // VAD callbacks -------------------------------------------------------------------------------------------
  onSpeechStart() {
    if (this._disposed) return;
    if (this.state.state === 'idle' || this.state.state === 'interrupted') this.state.transition('listening');
  }
  onBargeIn() { if (!this._disposed && (this.state.state === 'speaking' || this.state.state === 'thinking')) this.interrupt('barge-in'); }
  onMisfire() { if (this.state.state === 'listening') this.state.transition('idle'); }

  interrupt(reason) {
    if (this._abort) { try { this._abort.abort(); } catch (e) { /* ignore */ } this._abort = null; }
    if (this.audio && this.audio.stop) this.audio.stop();
    this.state.interrupt();
    this._emit('interrupted', { reason: reason || 'user' });
  }

  // Called with the audio of one finished utterance (Float32Array, 16 kHz). The array is consumed (transferred).
  async onUtterance(audio) {
    if (this._disposed) return;
    var turnId = this.state.beginTurn();
    this._cancelPrevious();
    this.state.transition('thinking');
    this.metrics.mark(turnId, 'speechEnd');
    var text;
    try {
      var r = await this.asr.transcribe(audio);
      text = r.text;
    } catch (e) { return this._fail(turnId, 'asr', e); }
    if (!this.state.isCurrent(turnId)) return;
    this.metrics.mark(turnId, 'asrDone');
    if (isLikelyNoise(text)) { this._emit('ignored', { turnId: turnId, text: text }); this.state.transition('idle'); return; }
    if (this.glossary) text = this.glossary.correct(text);
    return this._answer(turnId, text, 'voice');
  }

  // Typed input uses the same path from the backend onward (accessibility and fallback).
  async submitText(text) {
    if (this._disposed) return;
    text = String(text || '').trim(); if (!text) return;
    var turnId = this.state.beginTurn();
    this._cancelPrevious();
    this.state.transition('thinking');
    this.metrics.mark(turnId, 'speechEnd'); this.metrics.mark(turnId, 'asrDone');
    return this._answer(turnId, text, 'text');
  }

  /** How many sentences of the current answer have been, or are about to be, queued for speech. */
  pendingSentences() { return this._cur ? this._cur.pending() : 0; }

  _cancelPrevious() {
    if (this._abort) { try { this._abort.abort(); } catch (e) { /* ignore */ } }
    this._abort = new AbortController();
    if (this.audio && this.audio.isSpeaking && this.audio.isSpeaking() && this.audio.stop) this.audio.stop();
  }

  async _answer(turnId, text, source) {
    var self = this, signal = this._abort.signal, current = function () { return self.state.isCurrent(turnId) && !signal.aborted && !self._disposed; };
    this._emit('transcript', { turnId: turnId, text: text, source: source });
    if (this.audio && this.audio.beginTurn) this.audio.beginTurn(turnId);
    // an instant, pre-recorded acknowledgment (made on this device when Talk opened) covers the moments before the answer's first words arrive
    if (this.ack && this.audio && this.audio.playBuffer) { try { var aw = this.ack(text); if (aw) this.audio.playBuffer(this.toAudioBuffer(aw), turnId); } catch (e) { /* the ack is optional */ } }
    var splitter = new SentenceSplitter({ fastFirst: true }), chain = Promise.resolve(), queued = 0, first = true, fullText = '', spoke = false, seq = 0;
    this._cur = { turnId: turnId, pending: function () { return seq + (splitter._buf && splitter._buf.trim() ? 1 : 0); } };

    var speak = function (sentence) {
      queued++; var idx = ++seq;
      chain = chain.then(async function () {
        if (!current()) return;
        var spoken = toSpeakable(sentence);
        if (!/[A-Za-z0-9]/.test(spoken)) { queued--; return; }
        var wav;
        try { wav = await self.tts.synthesize(spoken); } catch (e) { queued--; self._emit('error', { stage: 'tts', turnId: turnId, error: e }); return; }
        queued--;
        if (!current()) return;
        if (first) { first = false; self.metrics.mark(turnId, 'ttsDone'); }
        spoke = true;
        self.audio.playBuffer(self.toAudioBuffer(wav), turnId, { index: idx, text: sentence });
      });
    };

    try {
      var gotToken = false;
      for await (var delta of this.backend.respond({ text: text, turnId: turnId, signal: signal })) {
        if (!current()) break;
        if (!gotToken) { gotToken = true; this.metrics.mark(turnId, 'firstToken'); }
        fullText += delta;
        this._emit('assistant-text', { turnId: turnId, delta: delta });
        var sentences = splitter.push(delta);
        for (var i = 0; i < sentences.length; i++) {
          if (queued >= this.maxQueued) { await chain; if (!current()) break; }     // back-pressure on a runaway reply
          if (this.metrics.turns[turnId].firstSentence === undefined) this.metrics.mark(turnId, 'firstSentence');
          speak(sentences[i]);
        }
      }
      if (current()) { var rest = splitter.flush(); for (var j = 0; j < rest.length; j++) { if (this.metrics.turns[turnId].firstSentence === undefined) this.metrics.mark(turnId, 'firstSentence'); speak(rest[j]); } }
    } catch (e) { if (current()) return this._fail(turnId, 'backend', e); return; }

    await chain;
    if (!current()) return;
    this._emit('assistant-complete', { turnId: turnId, text: fullText });
    if (spoke) this.audio.endTurn(turnId);
    else { this.metrics.mark(turnId, 'turnEnd'); this.state.transition('idle'); }
  }

  _fail(turnId, stage, error) {
    this._emit('error', { stage: stage, turnId: turnId, error: error });
    if (this.state.isCurrent(turnId)) { if (this.audio && this.audio.stop) this.audio.stop(); this.state.reset(); }
  }

  dispose() {
    this._disposed = true;
    if (this._abort) { try { this._abort.abort(); } catch (e) { /* ignore */ } }
    for (var i = 0; i < this._offAudio.length; i++) this._offAudio[i]();
    this._offAudio = [];
  }
}
