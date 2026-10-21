// instructor-state.js - conversational state machine for the AI instructor.
// States: idle, listening, thinking, speaking, interrupted.
export var STATES = ['idle', 'listening', 'thinking', 'speaking', 'interrupted'];

var ALLOWED = {
  idle: ['listening', 'thinking', 'speaking'],
  listening: ['idle', 'thinking', 'interrupted'],
  thinking: ['idle', 'speaking', 'interrupted', 'listening'],
  speaking: ['idle', 'interrupted', 'listening'],
  interrupted: ['listening', 'idle', 'thinking']
};

export function InstructorStateMachine(initial) {
  this._state = initial || 'idle';
  this._turn = 0;
  this._subs = [];
}
Object.defineProperty(InstructorStateMachine.prototype, 'state', { get: function () { return this._state; } });
Object.defineProperty(InstructorStateMachine.prototype, 'turnId', { get: function () { return this._turn; } });

InstructorStateMachine.prototype.canTransition = function (to) {
  return to === this._state ? true : (ALLOWED[this._state] || []).indexOf(to) >= 0;
};
// Returns true if the state is now `to`. Invalid transitions are refused (state unchanged, returns false).
InstructorStateMachine.prototype.transition = function (to, meta) {
  if (STATES.indexOf(to) < 0) return false;
  if (to === this._state) return true;
  if (!this.canTransition(to)) return false;
  var from = this._state;
  this._state = to;
  var subs = this._subs.slice();
  for (var i = 0; i < subs.length; i++) { try { subs[i](to, from, meta || {}); } catch (e) { /* subscriber errors must not break the machine */ } }
  return true;
};
// A new student turn begins: anything belonging to an earlier turn id is stale.
InstructorStateMachine.prototype.beginTurn = function () { this._turn += 1; return this._turn; };
InstructorStateMachine.prototype.isCurrent = function (id) { return id === this._turn; };
// Student interrupts: invalidate in-flight work from the current turn and go to `interrupted`.
InstructorStateMachine.prototype.interrupt = function () {
  this._turn += 1;
  return this.transition('interrupted', { turnId: this._turn });
};
InstructorStateMachine.prototype.reset = function () { this._turn += 1; this._state = 'idle'; };
InstructorStateMachine.prototype.subscribe = function (fn) {
  var self = this; this._subs.push(fn);
  return function () { var i = self._subs.indexOf(fn); if (i >= 0) self._subs.splice(i, 1); };
};
