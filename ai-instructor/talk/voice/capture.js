// capture.js - microphone capture at 16 kHz mono for the VAD. Raw audio stays in memory only.
// The student's browser does echo cancellation (so the instructor's own voice is mostly removed) and noise suppression.
import { StreamResampler, VAD_RATE } from './audio-utils.js?v=20261021a';

export class MicCapture {
  constructor(opts) {
    opts = opts || {};
    this.workletUrl = opts.workletUrl;               // same-origin URL of capture-worklet.js
    this.onChunk = opts.onChunk || function () {};
    this._nav = opts.navigator || (typeof navigator !== 'undefined' ? navigator : null);
    this._createContext = opts.createContext || function () { var C = window.AudioContext || window.webkitAudioContext; return new C({ latencyHint: 'interactive' }); };
    this.ctx = null; this.stream = null; this.node = null; this.running = false;
  }
  async start() {
    if (this.running) return;
    if (!this._nav || !this._nav.mediaDevices || !this._nav.mediaDevices.getUserMedia) { var e0 = new Error('microphone-unavailable'); e0.name = 'MicUnavailable'; throw e0; }
    this.stream = await this._nav.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    try {
      this.ctx = this._createContext();
      await this.ctx.audioWorklet.addModule(this.workletUrl);
      var src = this.ctx.createMediaStreamSource(this.stream), node = new AudioWorkletNode(this.ctx, 'mn-capture');
      var rs = new StreamResampler(this.ctx.sampleRate, VAD_RATE), self = this;
      node.port.onmessage = function (m) { var out = rs.push(m.data); if (out.length) self.onChunk(out); };
      var mute = this.ctx.createGain(); mute.gain.value = 0;            // keep the node pulled by the graph without playing the mic
      src.connect(node); node.connect(mute); mute.connect(this.ctx.destination);
      this.node = node; this._src = src; this._mute = mute;
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.running = true;
    } catch (e) { this.stop(); throw e; }
  }
  stop() {
    this.running = false;
    try { if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); } } catch (e) { /* ignore */ }
    try { if (this._src) this._src.disconnect(); } catch (e) { /* ignore */ }
    try { if (this._mute) this._mute.disconnect(); } catch (e) { /* ignore */ }
    if (this.stream) { this.stream.getTracks().forEach(function (t) { t.stop(); }); }       // releases the mic indicator
    if (this.ctx && this.ctx.close) { try { this.ctx.close(); } catch (e) { /* ignore */ } }
    this.stream = null; this.ctx = null; this.node = null;
  }
}
