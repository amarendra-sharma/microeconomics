// energy-vad.js - dependency-free fallback VAD used if the Silero model cannot load.
// Tracks an adaptive noise floor and maps frame energy to a pseudo-probability in [0,1].
// Less robust than Silero (fooled by loud non-speech noise); the UI should say so when it is active.
import { rms } from './audio-utils.js?v=20261021a';

export class EnergyVad {
  constructor(opts) {
    opts = opts || {};
    this.floor = opts.initialFloor === undefined ? 0.005 : opts.initialFloor;
    this.minRatio = opts.minRatio || 3;      // energy must exceed floor * minRatio to start counting
    this.fullRatio = opts.fullRatio || 8;    // energy at floor * fullRatio maps to prob ~1
    this.name = 'energy';
  }
  reset() {}
  async process(frame) {
    var e = rms(frame);
    var lo = this.floor * this.minRatio, hi = this.floor * this.fullRatio, p;
    if (e <= lo) p = 0; else if (e >= hi) p = 1; else p = (e - lo) / (hi - lo);
    // Floor adapts downward quickly and upward very slowly, so speech does not become the "noise".
    if (e < this.floor) this.floor = this.floor * 0.9 + e * 0.1;
    else if (p === 0) this.floor = this.floor * 0.995 + e * 0.005;
    if (this.floor < 0.0005) this.floor = 0.0005;
    return p;
  }
}
