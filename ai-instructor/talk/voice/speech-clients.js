// speech-clients.js - main-thread handles for the ASR and TTS workers. Same shape as the test fakes.
import { RpcClient } from './worker-rpc.js?v=20261021a';
import { sameOriginUrl } from './voice-config.js?v=20261021a';

function common(cfg, pageUrl, part) {
  var base = new URL(cfg.base, pageUrl).href;
  return {
    modelsUrl: sameOriginUrl('models/', base), wasmPaths: sameOriginUrl(cfg.speechRuntime, base),
    modelDir: part.modelDir, dtype: part.dtype, device: part.device
  };
}

export class AsrClient {
  constructor(cfg, pageUrl, makeWorker) {
    this.cfg = cfg; this.pageUrl = pageUrl; this.ready = false;
    var base = new URL(cfg.base, pageUrl).href;
    this.rpc = new RpcClient(makeWorker ? makeWorker(sameOriginUrl(cfg.asr.worker, base)) : new Worker(sameOriginUrl(cfg.asr.worker, base), { type: 'module' }));
  }
  onEvent(fn) { this.rpc.onEvent(fn); }
  async load() { var info = await this.rpc.call('init', common(this.cfg, this.pageUrl, this.cfg.asr)); this.ready = true; return info; }
  // audio: Float32Array, 16 kHz mono. The buffer is transferred (zero-copy) and then unusable by the caller.
  async transcribe(audio) { return this.rpc.call('transcribe', { audio: audio }, [audio.buffer]); }
  dispose() { this.rpc.terminate(); this.ready = false; }
}

export class TtsClient {
  constructor(cfg, pageUrl, makeWorker) {
    this.cfg = cfg; this.pageUrl = pageUrl; this.ready = false;
    var base = new URL(cfg.base, pageUrl).href;
    this.rpc = new RpcClient(makeWorker ? makeWorker(sameOriginUrl(cfg.tts.worker, base)) : new Worker(sameOriginUrl(cfg.tts.worker, base), { type: 'module' }));
  }
  onEvent(fn) { this.rpc.onEvent(fn); }
  async load() { var info = await this.rpc.call('init', common(this.cfg, this.pageUrl, this.cfg.tts)); this.ready = true; return info; }
  async synthesize(text) { return this.rpc.call('synthesize', { text: text, voice: this.cfg.tts.voice, speed: this.cfg.tts.speed }); }
  dispose() { this.rpc.terminate(); this.ready = false; }
}
