// voice/index.js - assembles the voice subsystem: mic -> VAD -> (utterance) -> ASR -> backend -> TTS -> audio.
// The instructor avatar's InstructorAudio and InstructorStateMachine are passed in, so lip-sync and states keep working.
import { resolveConfig } from './voice-config.js?v=20261021a';
import { MicCapture } from './capture.js?v=20261021a';
import { SileroVad } from './silero.js?v=20261021a';
import { EnergyVad } from './energy-vad.js?v=20261021a';
import { VadSegmenter } from './vad-segmenter.js?v=20261021a';
import { VadPipeline } from './vad-pipeline.js?v=20261021a';
import { AsrClient, TtsClient } from './speech-clients.js?v=20261021a';
import { VoiceTurnController } from './turn-controller.js?v=20261021a';
import { GlossaryCorrector } from './text-prep.js?v=20261021a';

export async function createVoice(o) {
  var cfg = resolveConfig(o.config, o.pageUrl || location.href), base = new URL(cfg.base, o.pageUrl || location.href).href;
  var info = { vad: 'none', fallbackVad: false };
  var vad;
  try {
    var ort = await import(new URL(cfg.vad.ortPath + 'ort.wasm.min.mjs', base).href);
    ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = new URL(cfg.vad.ortPath, base).href;
    vad = await SileroVad.create(ort, new URL(cfg.vad.model, base).href); info.vad = 'silero';
  } catch (e) { vad = new EnergyVad(); info.vad = 'energy'; info.fallbackVad = true; info.vadError = String(e && e.message || e); }
  var asr = new AsrClient(cfg, o.pageUrl || location.href), tts = o.tts || new TtsClient(cfg, o.pageUrl || location.href);   // o.tts: optional stand-in (e.g. device voices, nothing to download)
  var audioCtx = function () { return o.audio.ctx || (o.audio.unlock && o.audio.unlock(), o.audio.ctx); };
  var ctrl = new VoiceTurnController({
    state: o.state, audio: o.audio, asr: asr, tts: tts, backend: o.backend,
    glossary: o.glossary ? new GlossaryCorrector(o.glossary.terms, o.glossary.aliases) : null,
    maxQueuedSentences: cfg.limits.maxQueuedSentences,
    toAudioBuffer: o.toAudioBuffer || function (w) { var c = audioCtx(), b = c.createBuffer(1, w.samples.length, w.sampleRate); b.copyToChannel(w.samples, 0); return b; }
  });
  var seg = new VadSegmenter({ minSpeechMs: cfg.limits.minUtteranceMs, maxSegmentMs: cfg.limits.maxUtteranceMs });
  var pipe = new VadPipeline(vad, seg, function (ev) {
    if (ev.type === 'speech-start') ctrl.onSpeechStart();
    else if (ev.type === 'barge-in') ctrl.onBargeIn();
    else if (ev.type === 'misfire') ctrl.onMisfire();
    else if (ev.type === 'speech-end') ctrl.onUtterance(ev.audio);          // audio is consumed and then dropped
  });
  o.audio.on && o.audio.on('start', function () { seg.setAssistantSpeaking(true); });
  o.audio.on && o.audio.on('end', function () { seg.setAssistantSpeaking(false); });
  o.audio.on && o.audio.on('stopped', function () { seg.setAssistantSpeaking(false); });
  var mic = new MicCapture({ workletUrl: new URL('voice/capture-worklet.js', base).href, onChunk: function (c) { pipe.feed(c); } });
  return {
    info: info, controller: ctrl, config: cfg,
    // Loading is separate so the UI can show progress and the student can choose when to download ~170 MB.
    loadModels: function (onEvent) { if (onEvent) { asr.onEvent(onEvent); if (tts.onEvent) tts.onEvent(onEvent); } return Promise.all([asr.load(), tts.load()]); },
    startListening: function () { return mic.start(); },
    stopListening: function () { mic.stop(); return pipe.flush(); },
    submitText: function (t) { return ctrl.submitText(t); },
    dispose: function () { mic.stop(); ctrl.dispose(); asr.dispose(); tts.dispose(); if (vad.dispose) vad.dispose(); }
  };
}
