// vad-segmenter.js - turns a stream of per-frame speech probabilities into speech segments.
// Pure logic (no audio APIs, no models), so it is fully unit-testable. One frame = frameSamples at 16 kHz.
//
// Events returned from push():
//   {type:'speech-start', atMs}            confirmed after startFrames consecutive speech frames
//   {type:'speech-end', audio, durationMs, reason}   reason: 'silence' | 'max-length' | 'flush'
//   {type:'misfire', durationMs}           speech shorter than minSpeechMs (dropped, not sent to ASR)
//   {type:'barge-in', atMs}                only while setAssistantSpeaking(true): sustained speech
import { concat } from './audio-utils.js?v=20261021a';

export class VadSegmenter {
  constructor(opts) {
    opts = opts || {};
    this.frameSamples = opts.frameSamples || 512;
    this.rate = opts.rate || 16000;
    this.frameMs = (this.frameSamples / this.rate) * 1000;
    this.startThreshold = opts.startThreshold === undefined ? 0.5 : opts.startThreshold;
    this.endThreshold = opts.endThreshold === undefined ? 0.35 : opts.endThreshold;
    this.startFrames = Math.max(1, Math.round((opts.startMs === undefined ? 96 : opts.startMs) / this.frameMs));
    this.hangoverFrames = Math.max(1, Math.round((opts.hangoverMs === undefined ? 700 : opts.hangoverMs) / this.frameMs));
    this.minSpeechMs = opts.minSpeechMs === undefined ? 250 : opts.minSpeechMs;
    this.maxSegmentMs = opts.maxSegmentMs === undefined ? 30000 : opts.maxSegmentMs;
    this.preRollFrames = Math.max(0, Math.round((opts.preRollMs === undefined ? 320 : opts.preRollMs) / this.frameMs));
    // While the instructor talks, its own voice leaking into the mic must not count as the student.
    this.bargeInFrames = Math.max(1, Math.round((opts.bargeInMs === undefined ? 320 : opts.bargeInMs) / this.frameMs));
    this.bargeInThreshold = opts.bargeInThreshold === undefined ? 0.75 : opts.bargeInThreshold;
    this.assistantSpeaking = false;
    this.reset();
  }
  reset() {
    this._frameNo = 0; this._pre = []; this._seg = null; this._candidate = []; this._silence = 0;
    this._bargeRun = 0; this._bargeFired = false;
  }
  setAssistantSpeaking(on) { this.assistantSpeaking = !!on; this._bargeRun = 0; this._bargeFired = false; }
  get inSpeech() { return !!this._seg; }

  push(frame, prob) {
    var ev = [], atMs = this._frameNo * this.frameMs;
    this._frameNo++;
    // Barge-in is evaluated on its own, stricter, threshold and only while the assistant speaks.
    if (this.assistantSpeaking) {
      if (prob >= this.bargeInThreshold) {
        this._bargeRun++;
        if (this._bargeRun >= this.bargeInFrames && !this._bargeFired) { this._bargeFired = true; ev.push({ type: 'barge-in', atMs: atMs }); }
      } else { this._bargeRun = 0; }
    }
    if (!this._seg) {
      if (prob >= this.startThreshold) {
        this._candidate.push(frame);
        if (this._candidate.length >= this.startFrames) {
          this._seg = { frames: this._pre.concat(this._candidate), speechFrames: this._candidate.length, startMs: atMs - (this._candidate.length - 1) * this.frameMs };
          this._candidate = []; this._pre = []; this._silence = 0;
          ev.push({ type: 'speech-start', atMs: this._seg.startMs });
        }
      } else {
        // A broken run of speech frames is not speech; it becomes pre-roll context instead.
        for (var i = 0; i < this._candidate.length; i++) this._pushPre(this._candidate[i]);
        this._candidate = [];
        this._pushPre(frame);
      }
      return ev;
    }
    var seg = this._seg;
    seg.frames.push(frame);
    if (prob >= this.endThreshold) { this._silence = 0; seg.speechFrames++; } else { this._silence++; }
    var lenMs = seg.frames.length * this.frameMs;
    if (this._silence >= this.hangoverFrames) { this._finish(ev, 'silence'); }
    else if (lenMs >= this.maxSegmentMs) { this._finish(ev, 'max-length'); }
    return ev;
  }
  // Call when capture stops so an in-progress utterance is not lost.
  flush() {
    var ev = [];
    if (this._seg) this._finish(ev, 'flush');
    this._candidate = []; this._pre = [];
    return ev;
  }
  _pushPre(frame) {
    if (this.preRollFrames === 0) return;
    this._pre.push(frame);
    if (this._pre.length > this.preRollFrames) this._pre.shift();
  }
  _finish(ev, reason) {
    var seg = this._seg; this._seg = null; this._silence = 0;
    // Trim trailing silence beyond a short tail so the ASR does not process dead air.
    var tail = Math.min(this.hangoverFrames, Math.round(200 / this.frameMs));
    var frames = seg.frames;
    if (reason === 'silence' && frames.length > this.hangoverFrames) frames = frames.slice(0, frames.length - this.hangoverFrames + tail);
    var speechMs = seg.speechFrames * this.frameMs;
    if (speechMs < this.minSpeechMs) { ev.push({ type: 'misfire', durationMs: speechMs }); return; }
    ev.push({ type: 'speech-end', audio: concat(frames), durationMs: frames.length * this.frameMs, reason: reason });
  }
}
