// vad-pipeline.js - feeds arbitrary-sized 16 kHz chunks through a VAD and a VadSegmenter.
// Chunks are queued and processed strictly in order, so slow inference never reorders audio.
import { SILERO_FRAME } from './silero.js?v=20261021a';

export class VadPipeline {
  constructor(vad, segmenter, onEvent, opts) {
    opts = opts || {};
    this.vad = vad; this.seg = segmenter; this.onEvent = onEvent || function () {};
    this.frame = opts.frameSamples || SILERO_FRAME;
    this._buf = new Float32Array(0); this._chain = Promise.resolve(); this._errors = 0;
    this.stats = { frames: 0, inferenceMs: 0, maxInferenceMs: 0 };
    this._now = opts.now || function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
  }
  feed(chunk) {
    var self = this;
    this._chain = this._chain.then(function () { return self._feed(chunk); }).catch(function (e) { self._errors++; self.lastError = e; });
    return this._chain;
  }
  async _feed(chunk) {
    var merged = new Float32Array(this._buf.length + chunk.length);
    merged.set(this._buf, 0); merged.set(chunk, this._buf.length);
    var off = 0;
    while (merged.length - off >= this.frame) {
      var frame = merged.slice(off, off + this.frame); off += this.frame;
      var t0 = this._now(), p = await this.vad.process(frame), dt = this._now() - t0;
      this.stats.frames++; this.stats.inferenceMs += dt; if (dt > this.stats.maxInferenceMs) this.stats.maxInferenceMs = dt;
      var ev = this.seg.push(frame, p);
      for (var i = 0; i < ev.length; i++) this.onEvent(ev[i]);
    }
    this._buf = merged.slice(off);
  }
  async flush() {
    await this._chain;
    var ev = this.seg.flush();
    for (var i = 0; i < ev.length; i++) this.onEvent(ev[i]);
  }
  get meanInferenceMs() { return this.stats.frames ? this.stats.inferenceMs / this.stats.frames : 0; }
}
