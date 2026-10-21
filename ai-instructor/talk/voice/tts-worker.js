// tts-worker.js - speech synthesis inside a Web Worker (student's browser). Kokoro-82M via kokoro-js.
// kokoro-js hard-codes the voice-pack URL on huggingface.co; the network guard rewrites exactly that prefix
// to our own copy and blocks everything else cross-origin.
import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import { installNetworkGuard } from './network-guard.js';
import { serveRpc } from './worker-rpc.js';

var HF_VOICES = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/';
var tts = null;

serveRpc(self, {
  init: async function (p, emit) {
    installNetworkGuard(self, {
      rewrites: [{ from: HF_VOICES, to: p.modelsUrl + p.modelDir + '/voices/' }],
      onBlocked: function (k, u) { emit({ kind: 'blocked', request: k, url: u }); }
    });
    env.allowRemoteModels = false; env.allowLocalModels = true;
    env.localModelPath = p.modelsUrl;
    env.backends.onnx.wasm.wasmPaths = p.wasmPaths;
    env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, self.navigator.hardwareConcurrency || 2) : 1;
    var t0 = performance.now();
    tts = await KokoroTTS.from_pretrained(p.modelDir, {
      dtype: p.dtype, device: p.device,
      progress_callback: function (e) { emit({ kind: 'progress', stage: 'tts', info: e }); }
    });
    return { loadMs: performance.now() - t0, voices: Object.keys(tts.voices || {}) };
  },
  synthesize: async function (p) {
    if (!tts) throw new Error('TTS not initialised');
    var t0 = performance.now();
    var raw = await tts.generate(p.text, { voice: p.voice, speed: p.speed });
    var samples = raw.audio;
    return { __transfer: [samples.buffer], value: { samples: samples, sampleRate: raw.sampling_rate, ms: performance.now() - t0 } };
  },
  dispose: async function () { tts = null; return true; }
});
