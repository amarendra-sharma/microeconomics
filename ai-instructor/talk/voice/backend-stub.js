// backend-stub.js - the contract the conversational backend (Prompt 5) must satisfy, plus a scripted stand-in.
//   backend.respond({ text, turnId, signal }) -> AsyncIterable<string>   (text deltas, in order)
// The controller aborts `signal` when the student interrupts, so a real backend must stop work promptly.
export class ScriptedBackend {
  constructor(opts) {
    opts = opts || {};
    this.reply = opts.reply || 'Comparative advantage means a country should specialise where its opportunity cost is lowest. That is why both sides can gain from trade.';
    this.deltaChars = opts.deltaChars || 12; this.delayMs = opts.delayMs === undefined ? 0 : opts.delayMs;
    this.calls = [];
  }
  async *respond(req) {
    this.calls.push({ text: req.text, turnId: req.turnId });
    var r = typeof this.reply === 'function' ? this.reply(req.text) : this.reply;
    for (var i = 0; i < r.length; i += this.deltaChars) {
      if (req.signal && req.signal.aborted) return;
      if (this.delayMs) await new Promise(function (res) { setTimeout(res, this.delayMs); }.bind(this));
      yield r.slice(i, i + this.deltaChars);
    }
  }
}
