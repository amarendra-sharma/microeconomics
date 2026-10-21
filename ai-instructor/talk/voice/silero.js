// silero.js - Silero VAD v5 (MIT) through onnxruntime-web, running in the student's browser.
// The runtime is injected (`ort`) so nothing here fetches code from the network.
// Model I/O (verified by loading the shipped model): inputs input[1,576] f32, state[2,1,128] f32, sr int64 scalar;
// outputs output[1,1] f32, stateN[2,1,128] f32. 512 new samples per 16 kHz frame plus 64 samples of context.
export const SILERO_FRAME = 512;
const CONTEXT = 64;

export class SileroVad {
  constructor(ort, session) {
    this.ort = ort; this.session = session; this.name = 'silero';
    this.reset();
  }
  static async create(ort, source) {
    // source: URL string (same-origin path to the self-hosted model) or Uint8Array of the model bytes
    var session = await ort.InferenceSession.create(source, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return new SileroVad(ort, session);
  }
  reset() {
    this._state = new Float32Array(2 * 1 * 128);
    this._ctx = new Float32Array(CONTEXT);
    this._srTensor = null;
  }
  // frame: Float32Array(512) at 16 kHz. Returns speech probability in [0,1].
  async process(frame) {
    if (frame.length !== SILERO_FRAME) throw new Error('SileroVad needs exactly ' + SILERO_FRAME + ' samples per frame');
    var ort = this.ort, x = new Float32Array(CONTEXT + SILERO_FRAME);
    x.set(this._ctx, 0); x.set(frame, CONTEXT);
    this._ctx = frame.slice(SILERO_FRAME - CONTEXT);
    if (!this._srTensor) this._srTensor = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
    var out = await this.session.run({
      input: new ort.Tensor('float32', x, [1, x.length]),
      state: new ort.Tensor('float32', this._state, [2, 1, 128]),
      sr: this._srTensor
    });
    this._state = new Float32Array(out.stateN.data);
    return out.output.data[0];
  }
  async dispose() { if (this.session && this.session.release) { try { await this.session.release(); } catch (e) { /* ignore */ } } this.session = null; }
}
