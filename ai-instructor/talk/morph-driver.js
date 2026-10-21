// morph-driver.js - pure animation logic (no three.js): blinking, expressions, idle pose.
// Everything returns plain numbers/objects so it can be unit-tested without a GPU.

export function createBlinkScheduler(rng) {
  rng = rng || Math.random;
  var t = 0, next = 1.5 + rng() * 2, phase = 'wait', phaseT = 0, double = false;
  return {
    update: function (dt) {
      t += dt;
      if (phase === 'wait') {
        if (t >= next) { phase = 'closing'; phaseT = 0; double = rng() < 0.12; }
        return 0;
      }
      phaseT += dt;
      if (phase === 'closing') {
        var c = Math.min(1, phaseT / 0.07);
        if (c >= 1) { phase = 'opening'; phaseT = 0; }
        return c;
      }
      var o = Math.min(1, phaseT / 0.12);
      if (o >= 1) {
        if (double) { double = false; phase = 'closing'; phaseT = 0; return 0; }
        phase = 'wait'; t = 0; next = 2.5 + rng() * 3.5; return 0;
      }
      return 1 - o;
    }
  };
}

// Expression presets use ARKit-style names. Missing names on a model are ignored by the applier.
export var EXPRESSIONS = {
  neutral: {},
  friendly: { mouthSmileLeft: 0.30, mouthSmileRight: 0.30, cheekSquintLeft: 0.10, cheekSquintRight: 0.10, browInnerUp: 0.08 },
  curious: { browInnerUp: 0.40, browOuterUpLeft: 0.18, browOuterUpRight: 0.18, eyeWideLeft: 0.15, eyeWideRight: 0.15, mouthSmileLeft: 0.08, mouthSmileRight: 0.08 },
  concerned: { browInnerUp: 0.45, browDownLeft: 0.12, browDownRight: 0.12, mouthFrownLeft: 0.18, mouthFrownRight: 0.18 },
  thinking: { browInnerUp: 0.18, browDownLeft: 0.15, mouthPucker: 0.12, eyeWideLeft: 0.05 },
  surprised: { browInnerUp: 0.55, browOuterUpLeft: 0.45, browOuterUpRight: 0.45, eyeWideLeft: 0.40, eyeWideRight: 0.40, jawOpen: 0.12 }
};
export var STATE_EXPRESSION = { idle: 'friendly', listening: 'curious', thinking: 'thinking', speaking: 'friendly', interrupted: 'surprised' };

// Eases current expression weights toward a target preset (time constant tau seconds).
export function ExpressionBlender(tau) {
  this.tau = tau || 0.18; this.current = {}; this.target = {};
}
ExpressionBlender.prototype.set = function (name, intensity) {
  var base = EXPRESSIONS[name] || EXPRESSIONS.neutral, k = intensity === undefined ? 1 : Math.max(0, Math.min(1, intensity));
  this.target = {};
  for (var n in base) this.target[n] = base[n] * k;
};
ExpressionBlender.prototype.update = function (dt) {
  var a = 1 - Math.exp(-dt / this.tau), names = {}, n;
  for (n in this.current) names[n] = 1;
  for (n in this.target) names[n] = 1;
  for (n in names) {
    var cur = this.current[n] || 0, tgt = this.target[n] || 0;
    var v = cur + (tgt - cur) * a;
    if (Math.abs(v) < 0.0005 && tgt === 0) delete this.current[n]; else this.current[n] = v;
  }
  return this.current;
};

// Subtle head sway/breathing. Returns radians for the head and a breath value in [-1, 1].
export function idlePose(time, state, speechLevel, reducedMotion) {
  if (reducedMotion) return { rx: 0, ry: 0, rz: 0, breath: 0 };
  var amp = { idle: 1, listening: 0.7, thinking: 0.8, speaking: 1.2, interrupted: 0.5 }[state];
  if (amp === undefined) amp = 1;
  var lvl = speechLevel || 0;
  var rx = 0.012 * Math.sin(time * 0.61) + 0.008 * Math.sin(time * 1.37 + 1.3);
  var ry = 0.030 * Math.sin(time * 0.37 + 0.4) + 0.012 * Math.sin(time * 0.93);
  var rz = 0.010 * Math.sin(time * 0.53 + 2.1);
  if (state === 'speaking') { rx += 0.030 * lvl * Math.sin(time * 5.2); ry += 0.015 * lvl * Math.sin(time * 3.1 + 0.7); }
  if (state === 'listening') { rz += 0.040; rx += 0.010; }          // attentive tilt
  if (state === 'thinking') { rx -= 0.040; ry += 0.050; }          // glance up and aside
  return { rx: rx * amp, ry: ry * amp, rz: rz * amp, breath: Math.sin(time * 1.25) };
}
