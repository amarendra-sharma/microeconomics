// panel.js - the instructor panel: stage, status indicators, transcript, controls, text fallback, error state.
// Uses textContent only (never innerHTML) so transcript text can never inject markup.
import { requestMicPermission } from './mic.js?v=20261021a';

var CSS = [
'.mnai{--navy:#0f1d33;--navy2:#17263a;--gold:#d9b86a;--ink:#e9eef6;--mute:#9fb0c6;--bad:#ff8a80;--ok:#7fd3a0;display:grid;gap:10px;align-content:start;grid-template-columns:minmax(0,1fr);max-width:980px;margin:0 auto;padding:12px;background:var(--navy);color:var(--ink);border:1px solid #2b3d58;border-radius:14px;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}',
'.mnai *{box-sizing:border-box}',
'.mnai-stage{position:relative;aspect-ratio:4/3;max-height:62vh;background:var(--navy2);border-radius:10px;overflow:hidden}',
'.mnai-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;text-align:center;background:rgba(11,21,34,.82)}',
'.mnai-overlay[hidden]{display:none}',
'.mnai-bar{width:min(260px,70%);height:6px;border-radius:3px;background:#2b3d58;overflow:hidden}',
'.mnai-bar>i{display:block;height:100%;width:0;background:var(--gold);transition:width .2s}',
'.mnai-fallback{width:96px;height:96px;border-radius:50%;background:var(--gold);color:var(--navy);display:grid;place-items:center;font-weight:700;font-size:28px;box-shadow:0 0 0 calc(var(--lvl,0)*18px) rgba(217,184,106,.35);transition:box-shadow .08s}',
'.mnai-status{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-start;align-content:flex-start}',
'.mnai-chip{display:inline-block;line-height:1.5;padding:3px 10px;border-radius:999px;border:1px solid #2b3d58;color:var(--mute);font-size:13px}',
'.mnai-chip[data-on="true"]{border-color:var(--gold);color:var(--navy);background:var(--gold);font-weight:600}',
'.mnai-chip[data-bad="true"]{border-color:var(--bad);color:var(--bad)}',
'.mnai-actions{display:flex;flex-wrap:wrap;gap:8px}',
'.mnai button{min-height:44px;padding:0 16px;border-radius:10px;border:1px solid #3a5075;background:#1d3050;color:var(--ink);font:inherit;cursor:pointer}',
'.mnai button:hover:not(:disabled){background:#27406a}',
'.mnai button:disabled{opacity:.45;cursor:not-allowed}',
'.mnai button[aria-pressed="true"]{border-color:var(--gold);background:#3a3320}',
'.mnai :focus-visible{outline:3px solid #7cc4ff;outline-offset:2px}',
'.mnai-log{min-height:120px;max-height:240px;overflow:auto;padding:10px;background:#0b1522;border-radius:10px;border:1px solid #22344f}',
'.mnai-msg{margin:0 0 8px}.mnai-msg b{color:var(--gold);font-weight:600;margin-right:6px}',
'.mnai-form{display:flex;gap:8px}',
'.mnai-form input{flex:1;min-width:0;min-height:44px;padding:0 12px;border-radius:10px;border:1px solid #3a5075;background:#0b1522;color:var(--ink);font:inherit}',
'.mnai-error{padding:10px 12px;border-radius:10px;border:1px solid var(--bad);color:var(--bad);background:#2a1618}',
'.mnai-error[hidden]{display:none}',
'.mnai-note{font-size:12.5px;color:var(--mute)}',
'.mnai-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
'@media (min-width:860px){.mnai{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)}.mnai-stage{grid-row:1/span 4}}',
'@media (prefers-reduced-motion:reduce){.mnai *{transition:none!important;animation:none!important}}'
].join('\n');

var LABEL = { idle: 'Ready', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', interrupted: 'Interrupted' };
var MIC_TEXT = { unknown: 'Mic: not checked', requesting: 'Mic: asking permission…', ready: 'Mic: ready', denied: 'Mic: blocked', unavailable: 'Mic: unavailable', busy: 'Mic: in use', error: 'Mic: error' };

export function InstructorPanel(root, opts) {
  opts = opts || {};
  var doc = opts.doc || document, avatar = opts.avatar, audio = opts.audio, self = this;
  this.root = root; this.opts = opts; this.avatar = avatar; this.audio = audio; this._unsubs = []; this._listeners = []; this._disposed = false;
  this.micStatus = 'unknown'; this._messages = [];
  this.maxMessages = opts.maxMessages || 200; this.maxInput = opts.maxInput || 1000;

  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function listen(target, type, fn) { target.addEventListener(type, fn); self._listeners.push([target, type, fn]); }

  if (!doc.getElementById || !doc.getElementById('mnai-styles')) {
    var st = el('style'); st.id = 'mnai-styles'; st.textContent = CSS;
    (doc.head || doc.body || root).appendChild(st); this._style = st;
  }
  var wrap = el('section', 'mnai'); wrap.setAttribute('aria-label', 'AI instructor'); this.wrap = wrap;
  this.stage = el('div', 'mnai-stage');                       // avatar canvas is mounted here by the caller
  this.overlay = el('div', 'mnai-overlay'); this.overlay.hidden = true; this.overlay.setAttribute('role', 'status');
  this.overlayText = el('div', '', ''); this.bar = el('div', 'mnai-bar'); this.barFill = el('i'); this.bar.appendChild(this.barFill);
  this.fallback = el('div', 'mnai-fallback', 'AI'); this.fallback.hidden = true; this.fallback.setAttribute('aria-hidden', 'true');
  this.overlay.appendChild(this.fallback); this.overlay.appendChild(this.overlayText); this.overlay.appendChild(this.bar);
  this.stage.appendChild(this.overlay);

  this.status = el('div', 'mnai-status'); this.status.setAttribute('role', 'group'); this.status.setAttribute('aria-label', 'Instructor status');
  this.chips = {};
  var order = ['mic', 'listening', 'thinking', 'speaking'];
  for (var i = 0; i < order.length; i++) { var c = el('span', 'mnai-chip', order[i] === 'mic' ? MIC_TEXT.unknown : LABEL[order[i]]); c.setAttribute('data-on', 'false'); this.chips[order[i]] = c; this.status.appendChild(c); }
  this.live = el('div', 'mnai-sr'); this.live.setAttribute('aria-live', 'polite'); this.live.setAttribute('role', 'status');

  this.actions = el('div', 'mnai-actions');
  this.pttBtn = el('button', '', 'Hold to talk'); this.pttBtn.type = 'button';
  this.muteBtn = el('button', '', 'Mute instructor'); this.muteBtn.type = 'button'; this.muteBtn.setAttribute('aria-pressed', 'false');
  this.stopBtn = el('button', '', 'Interrupt'); this.stopBtn.type = 'button'; this.stopBtn.disabled = true;
  this.actions.appendChild(this.pttBtn); this.actions.appendChild(this.muteBtn); this.actions.appendChild(this.stopBtn);

  this.log = el('div', 'mnai-log'); this.log.setAttribute('role', 'log'); this.log.setAttribute('aria-label', 'Conversation transcript'); this.log.setAttribute('aria-live', 'polite');
  this.form = el('form', 'mnai-form'); this.form.setAttribute('aria-label', 'Type a question');
  var lab = el('label', 'mnai-sr', 'Type your question'); this.input = el('input'); this.input.type = 'text'; this.input.setAttribute('maxlength', String(this.maxInput)); this.input.setAttribute('autocomplete', 'off'); this.input.setAttribute('placeholder', 'Type a question…'); this.input.id = 'mnai-input-' + Math.floor(Math.random() * 1e6); lab.setAttribute('for', this.input.id);
  this.sendBtn = el('button', '', 'Send'); this.sendBtn.type = 'submit';
  this.form.appendChild(lab); this.form.appendChild(this.input); this.form.appendChild(this.sendBtn);
  this.errorBox = el('div', 'mnai-error'); this.errorBox.hidden = true; this.errorBox.setAttribute('role', 'alert');
  this.note = el('div', 'mnai-note', opts.privacyNote || '');
  this.note.hidden = !opts.privacyNote;

  wrap.appendChild(this.stage); wrap.appendChild(this.status); wrap.appendChild(this.actions); wrap.appendChild(this.log);
  wrap.appendChild(this.form); wrap.appendChild(this.errorBox); wrap.appendChild(this.note); wrap.appendChild(this.live);
  root.appendChild(wrap);

  // ---- wiring ----
  listen(this.form, 'submit', function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); self._submitText(); });
  listen(this.stopBtn, 'click', function () { self.interrupt(); });
  listen(this.muteBtn, 'click', function () { self.setMuted(!(audio && audio.isMuted())); });
  var down = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); self._ptt(true); };
  var up = function () { self._ptt(false); };
  listen(this.pttBtn, 'pointerdown', down); listen(this.pttBtn, 'pointerup', up); listen(this.pttBtn, 'pointerleave', up); listen(this.pttBtn, 'pointercancel', up);
  listen(this.pttBtn, 'keydown', function (ev) { if (ev && (ev.key === ' ' || ev.key === 'Enter') && !ev.repeat) down(ev); });
  listen(this.pttBtn, 'keyup', function (ev) { if (ev && (ev.key === ' ' || ev.key === 'Enter')) up(); });

  if (avatar) {
    this._unsubs.push(avatar.on('state', function (e) { self._renderState(e.state); }));
    this._unsubs.push(avatar.on('loadstate', function (e) { self._renderLoad(e); }));
    this._unsubs.push(avatar.on('error', function (e) { self.showError(self._friendly(e)); }));
    this._unsubs.push(avatar.on('fallback', function () { self._showFallback(); }));
    this._unsubs.push(avatar.on('fallbacklevel', function (e) { self.fallback.style.setProperty('--lvl', String(e.level)); }));
    this._unsubs.push(avatar.on('progress', function (p) { self.barFill.style.width = Math.round(p * 100) + '%'; self.overlayText.textContent = 'Loading instructor… ' + Math.round(p * 100) + '%'; }));
    this._renderLoad({ state: avatar.loadState, error: avatar.loadError });
    this._renderState(avatar.machine.state);
  }
}

InstructorPanel.prototype._friendly = function (e) {
  var map = {
    'model-url-blocked': 'The instructor model is not configured for this site, so the animated instructor is unavailable.',
    'model-load-failed': 'The instructor model could not be loaded.',
    'webgl-unavailable': 'This device cannot show the 3D instructor.',
    'webgl-context-lost': 'The 3D display stopped working.'
  };
  return (map[e.code] || 'The animated instructor is unavailable.') + ' You can still learn here using the text box below.';
};
InstructorPanel.prototype._showFallback = function () {
  this.overlay.hidden = false; this.fallback.hidden = false; this.bar.hidden = true;
  this.overlayText.textContent = 'Voice-only instructor';
};
InstructorPanel.prototype._renderLoad = function (e) {
  if (e.state === 'loading') { this.overlay.hidden = false; this.bar.hidden = false; this.fallback.hidden = true; this.overlayText.textContent = 'Loading instructor…'; this.barFill.style.width = '0%'; }
  else if (e.state === 'ready') { this.overlay.hidden = true; this.clearError(); }
  else if (e.state === 'error') { this._showFallback(); }
};
InstructorPanel.prototype._renderState = function (s) {
  this.chips.listening.setAttribute('data-on', String(s === 'listening'));
  this.chips.thinking.setAttribute('data-on', String(s === 'thinking'));
  this.chips.speaking.setAttribute('data-on', String(s === 'speaking'));
  this.stopBtn.disabled = !(s === 'speaking' || s === 'thinking');
  this.live.textContent = LABEL[s] || s;
};
InstructorPanel.prototype.setMic = function (status, message) {
  this.micStatus = status;
  this.chips.mic.textContent = MIC_TEXT[status] || MIC_TEXT.unknown;
  this.chips.mic.setAttribute('data-on', String(status === 'ready'));
  this.chips.mic.setAttribute('data-bad', String(status === 'denied' || status === 'unavailable' || status === 'busy' || status === 'error'));
  if (message && status !== 'ready') this.showError(message);
};
InstructorPanel.prototype.showError = function (msg) { this.errorBox.textContent = msg; this.errorBox.hidden = false; };
InstructorPanel.prototype.clearError = function () { this.errorBox.textContent = ''; this.errorBox.hidden = true; };

// role: 'student' | 'instructor'. Returns a handle so streamed text can be appended.
InstructorPanel.prototype.addMessage = function (role, text) {
  var doc = this.opts.doc || document, p = doc.createElement('p'); p.className = 'mnai-msg';
  var who = doc.createElement('b'); who.textContent = role === 'student' ? 'You' : 'Asha';
  var body = doc.createElement('span'); body.textContent = text || '';
  p.appendChild(who); p.appendChild(body); this.log.appendChild(p); this._messages.push(p);
  while (this._messages.length > this.maxMessages) { var old = this._messages.shift(); if (old.parentNode) old.parentNode.removeChild(old); }
  if (this.log.scrollHeight !== undefined) this.log.scrollTop = this.log.scrollHeight;
  return { set: function (t) { body.textContent = t; }, append: function (t) { body.textContent += t; } };
};
InstructorPanel.prototype.setMuted = function (m) {
  if (this.audio) this.audio.setMuted(m);
  this.muteBtn.setAttribute('aria-pressed', String(!!m));
  this.muteBtn.textContent = m ? 'Unmute instructor' : 'Mute instructor';
};
InstructorPanel.prototype.interrupt = function () {
  if (this.avatar) this.avatar.interrupt();
  if (this.opts.onInterrupt) this.opts.onInterrupt();
};
InstructorPanel.prototype._submitText = function () {
  var t = String(this.input.value || '').replace(/\s+/g, ' ').trim();
  if (!t) return;
  if (t.length > this.maxInput) t = t.slice(0, this.maxInput);
  this.input.value = '';
  if (this.avatar) {
    if (this.avatar.machine.state === 'speaking') this.avatar.interrupt();
    this.avatar.machine.beginTurn();
  }
  this.addMessage('student', t);
  if (this.avatar) { this.avatar.machine.transition('listening'); this.avatar.machine.transition('thinking'); }
  if (this.opts.onUserText) this.opts.onUserText(t, this.avatar ? this.avatar.machine.turnId : 0);
};
InstructorPanel.prototype._ptt = function (isDown) {
  var self = this;
  if (isDown) {
    if (this._pttActive) return;
    this._pttActive = true;
    if (this.audio) { try { var u = this.audio.unlock(); if (u && u.catch) u.catch(function () {}); } catch (e) { /* ignore */ } }
    var check = this.micStatus === 'ready' ? Promise.resolve({ status: 'ready' }) : (this.setMic('requesting'), (this.opts.requestMic || requestMicPermission)());
    check.then(function (r) {
      if (self._disposed) return;
      self.setMic(r.status, r.message);
      if (r.status !== 'ready') { self._pttActive = false; return; }
      if (!self._pttActive) return;                                    // released before permission resolved
      if (self.avatar) { if (self.avatar.machine.state === 'speaking') self.avatar.interrupt(); self.avatar.machine.beginTurn(); self.avatar.machine.transition('listening'); }
      if (self.opts.onPushToTalk) self.opts.onPushToTalk(true);
    });
  } else {
    if (!this._pttActive) return;
    this._pttActive = false;
    if (this.micStatus === 'ready') {
      if (this.opts.onPushToTalk) this.opts.onPushToTalk(false);
      if (this.avatar && this.avatar.machine.state === 'listening') this.avatar.machine.transition('thinking');
    }
  }
};
InstructorPanel.prototype.dispose = function () {
  if (this._disposed) return;
  this._disposed = true;
  for (var i = 0; i < this._unsubs.length; i++) this._unsubs[i]();
  for (var j = 0; j < this._listeners.length; j++) { var l = this._listeners[j]; l[0].removeEventListener(l[1], l[2]); }
  this._unsubs = []; this._listeners = [];
  if (this.wrap.parentNode) this.wrap.parentNode.removeChild(this.wrap);
  if (this._style && this._style.parentNode) this._style.parentNode.removeChild(this._style);
};
