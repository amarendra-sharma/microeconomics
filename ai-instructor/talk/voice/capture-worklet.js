// capture-worklet.js - runs on the audio thread. Batches 128-sample render quanta into ~1024-sample messages.
class MnCaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this._buf = new Float32Array(1024); this._n = 0; }
  process(inputs) {
    var ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (var i = 0; i < ch.length; i++) {
      this._buf[this._n++] = ch[i];
      if (this._n === this._buf.length) { this.port.postMessage(this._buf.slice(0)); this._n = 0; }
    }
    return true;
  }
}
registerProcessor('mn-capture', MnCaptureProcessor);
