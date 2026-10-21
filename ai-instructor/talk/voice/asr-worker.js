// asr-worker.js - speech recognition inside a Web Worker (student's browser). Whisper base.en via transformers.js.
// Bundled by tools/build-voice-bundles.mjs (so the bare import below resolves) into vendor/voice/asr-worker.bundle.js.
import { env, pipeline } from '@huggingface/transformers';
import { installNetworkGuard } from './network-guard.js';
import { serveRpc } from './worker-rpc.js';

var asr = null, guard = null;

serveRpc(self, {
  init: async function (p, emit) {
    guard = installNetworkGuard(self, { onBlocked: function (k, u) { emit({ kind: 'blocked', request: k, url: u }); } });
    // Self-hosted only: never reach for the Hugging Face hub, never load WASM from a CDN.
    env.allowRemoteModels = false; env.allowLocalModels = true;
    env.localModelPath = p.modelsUrl;
    env.backends.onnx.wasm.wasmPaths = p.wasmPaths;
    env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, self.navigator.hardwareConcurrency || 2) : 1;
    var t0 = performance.now();
    asr = await pipeline('automatic-speech-recognition', p.modelDir, {
      dtype: p.dtype, device: p.device,
      progress_callback: function (e) { emit({ kind: 'progress', stage: 'asr', info: e }); }
    });
    return { loadMs: performance.now() - t0, crossOriginIsolated: !!self.crossOriginIsolated, threads: env.backends.onnx.wasm.numThreads };
  },
  transcribe: async function (p) {
    if (!asr) throw new Error('ASR not initialised');
    var t0 = performance.now();
    var out = await asr(p.audio, { return_timestamps: false, chunk_length_s: 30 });
    return { text: (out && out.text ? out.text : '').trim(), ms: performance.now() - t0 };
  },
  dispose: async function () { if (asr && asr.dispose) await asr.dispose(); asr = null; return true; }
});
