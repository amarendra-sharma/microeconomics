// audio-utils.js - small, dependency-free helpers for 16 kHz mono float audio.
export const VAD_RATE = 16000;

export function rms(buf) {
  if (!buf || !buf.length) return 0;
  var s = 0;
  for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

export function concat(chunks) {
  var n = 0, i;
  for (i = 0; i < chunks.length; i++) n += chunks[i].length;
  var out = new Float32Array(n), o = 0;
  for (i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].length; }
  return out;
}

// Box-filter downsample (averages the source samples that fall in each output sample). Good enough
// for speech recognition input; no external library. Upsampling uses linear interpolation.
export function resample(input, inRate, outRate) {
  if (inRate === outRate) return input;
  var ratio = inRate / outRate, n = Math.floor(input.length / ratio), out = new Float32Array(n), i, j;
  if (ratio > 1) {
    for (i = 0; i < n; i++) {
      var a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio)), s = 0;
      if (b <= a) b = a + 1;
      for (j = a; j < b; j++) s += input[j];
      out[i] = s / (b - a);
    }
  } else {
    for (i = 0; i < n; i++) {
      var p = i * ratio, k = Math.floor(p), f = p - k, x0 = input[k], x1 = k + 1 < input.length ? input[k + 1] : x0;
      out[i] = x0 + (x1 - x0) * f;
    }
  }
  return out;
}

// Peak-normalise only if the clip is quiet; never amplifies noise-only clips beyond maxGain.
export function normalizeQuiet(buf, target, maxGain) {
  target = target || 0.5; maxGain = maxGain || 8;
  var peak = 0;
  for (var i = 0; i < buf.length; i++) { var a = Math.abs(buf[i]); if (a > peak) peak = a; }
  if (peak <= 0 || peak >= target) return buf;
  var g = Math.min(maxGain, target / peak), out = new Float32Array(buf.length);
  for (i = 0; i < buf.length; i++) out[i] = buf[i] * g;
  return out;
}

// Streaming resampler: output sample n always covers input [n*ratio, (n+1)*ratio) in absolute terms, so chunk
// boundaries cannot change the result (no clicks, no drift) even for 44.1 kHz -> 16 kHz. Box filter = cheap anti-alias.
export class StreamResampler {
  constructor(inRate, outRate) { this.ratio = inRate / outRate; this.passthrough = inRate === outRate; this._buf = new Float32Array(0); this._n = 0; this._base = 0; }
  push(chunk) {
    if (this.passthrough) return chunk;
    var buf = new Float32Array(this._buf.length + chunk.length);
    buf.set(this._buf, 0); buf.set(chunk, this._buf.length);
    var out = [], r = this.ratio;
    for (;;) {
      var a = Math.floor(this._n * r) - this._base, b = Math.floor((this._n + 1) * r) - this._base;
      if (b <= a) b = a + 1;
      if (b > buf.length) break;
      var s = 0; for (var j = a; j < b; j++) s += buf[j];
      out.push(s / (b - a)); this._n++;
    }
    var keep = Math.floor(this._n * r) - this._base;
    this._buf = buf.slice(keep); this._base += keep;
    return Float32Array.from(out);
  }
}
