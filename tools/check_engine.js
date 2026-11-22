// Boots the three exam-engine files the same way im-grade-attempt does and generates every
// item, so a broken file stops the deploy instead of breaking a student's exam.
// Usage, from the repo root:  node tools/check_engine.js
var fs = require("fs");

function run(src, c) { new Function("window", "global", src).call(c, c, c); }

var ctx = {};
ctx.window = ctx;
ctx.global = ctx;
var log = console.log;
console.log = function () {};
run(fs.readFileSync("im-diagrams.js", "utf8"), ctx);
run(fs.readFileSync("im-generators.js", "utf8"), ctx);
run(fs.readFileSync("im-econ160.js", "utf8"), ctx);
console.log = log;

var ids = ctx.IMGenerators.list().map(function (x) { return x.id; });
var bad = 0, figs = 0, addon = 0;
ids.forEach(function (id) {
  for (var s = 1; s <= 5; s++) {
    var q = null;
    try { q = ctx.IMGenerators.generate(id, s); } catch (e) { q = null; }
    if (!q) { bad++; console.log("no instance: " + id + " seed " + s); continue; }
    if (q.diagramSpec) {
      var svg = ctx.IMDiagrams.render(q.diagramSpec);
      if (!svg || svg.indexOf("<svg") === -1) { bad++; console.log("no figure: " + id + " seed " + s); } else { figs++; }
    }
    if (q.kind === "mc") {
      var g = ctx.IMGenerators.grade(id, s, q.answer);
      if (!(g && g.correct)) { bad++; console.log("key does not grade as correct: " + id + " seed " + s); }
    }
    if (/^IM_(ECON160|PM)_/.test(id)) addon++;
  }
});
console.log("generators " + ids.length + ", figures " + figs + ", add-on instances " + addon + ", failures " + bad);
if (bad || addon === 0) { process.exit(1); }
