// voice-config.js - one place that says where speech code and models come from. All URLs are same-origin
// paths under `base` (the folder Macronations deploys with the site). Nothing points at a third party.
export const DEFAULT_VOICE_CONFIG = {
  base: './',                                   // folder holding vendor/ and models/ (relative to the page)
  vad: { model: 'models/silero_vad.onnx', ortPath: 'vendor/ort/' },       // onnxruntime-web 1.22.0 release build, main thread
  speechRuntime: 'vendor/voice/',               // transformers.js's own onnxruntime build (wasm), used inside the workers
  asr: {
    worker: 'vendor/voice/asr-worker.bundle.js',
    modelDir: 'whisper-base.en',                // folder under models/ (see models.manifest.json)
    dtype: 'q8',
    device: 'wasm'                              // 'webgpu' is faster where available; benchmark decides
  },
  tts: {
    worker: 'vendor/voice/tts-worker.bundle.js',
    modelDir: 'kokoro-82m',
    dtype: 'q8',
    device: 'wasm',
    voice: 'af_heart',                          // a stock Kokoro voice; never a clone of a real person
    speed: 1.0
  },
  limits: { maxUtteranceMs: 30000, minUtteranceMs: 250, maxQueuedSentences: 8 },
  // Raw student audio is processed in memory and discarded. Nothing in this module persists it.
  persistAudio: false
};

export function resolveConfig(overrides, baseUrl) {
  var cfg = JSON.parse(JSON.stringify(DEFAULT_VOICE_CONFIG)), k, j;
  overrides = overrides || {};
  for (k in overrides) {
    if (!Object.prototype.hasOwnProperty.call(overrides, k)) continue;
    if (overrides[k] && typeof overrides[k] === 'object' && !Array.isArray(overrides[k]) && cfg[k]) { for (j in overrides[k]) cfg[k][j] = overrides[k][j]; }
    else cfg[k] = overrides[k];
  }
  if (cfg.persistAudio) throw new Error('persistAudio must stay false: raw student audio is never stored by default');
  if (baseUrl) cfg.baseUrl = baseUrl;
  return cfg;
}

// Same-origin check used before any worker or model URL is used.
export function sameOriginUrl(path, pageUrl) {
  var u = new URL(path, pageUrl);
  if (u.origin !== new URL(pageUrl).origin) throw new Error('Voice assets must be same-origin, refusing: ' + u.href);
  return u.href;
}
