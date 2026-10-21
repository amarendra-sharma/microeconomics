// metrics.js - per-turn latency marks. Stays in memory; the host decides whether/where to send aggregates.
export class TurnMetrics {
  constructor(now) { this._now = now || function () { return performance.now(); }; this.turns = {}; }
  mark(turnId, name, t) { var m = this.turns[turnId] || (this.turns[turnId] = {}); if (m[name] === undefined) m[name] = t === undefined ? this._now() : t; }
  // speech end -> first audible sample is the number that matters to the student.
  summary(turnId) {
    var m = this.turns[turnId] || {}, d = function (a, b) { return m[a] !== undefined && m[b] !== undefined ? m[b] - m[a] : null; };
    return {
      asrMs: d('speechEnd', 'asrDone'), backendFirstTokenMs: d('asrDone', 'firstToken'), firstSentenceMs: d('firstToken', 'firstSentence'),
      ttsFirstMs: d('firstSentence', 'ttsDone'), toFirstAudioMs: d('speechEnd', 'audioStart'), total: d('speechEnd', 'turnEnd')
    };
  }
  drop(turnId) { delete this.turns[turnId]; }
}
export function percentile(values, p) {
  if (!values.length) return null;
  var a = values.slice().sort(function (x, y) { return x - y; }), i = Math.min(a.length - 1, Math.max(0, Math.ceil(p / 100 * a.length) - 1));
  return a[i];
}
