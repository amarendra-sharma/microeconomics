// index.js - public entry. createInstructor() wires panel + audio + avatar with the self-hosted three.js backend.
import { AIInstructorAvatar } from './avatar.js?v=20261021a';
import { InstructorAudio } from './audio.js?v=20261021a';
import { InstructorPanel } from './panel.js?v=20261021a';
export { AIInstructorAvatar, InstructorAudio, InstructorPanel };
export { LipSyncController, VISEMES } from './lipsync.js?v=20261021a';
export { InstructorStateMachine, STATES } from './instructor-state.js?v=20261021a';
export { isApprovedModelUrl } from './config.js?v=20261021a';
export { requestMicPermission } from './mic.js?v=20261021a';

// options: { modelUrl, approvedOrigins, allowRelativeDev, privacyNote, onUserText, onPushToTalk, onInterrupt }
// Returns { avatar, audio, panel, ready: Promise, dispose() }. Nothing is fetched until you call it.
export function createInstructor(root, options) {
  options = options || {};
  var audio = options.audio || new InstructorAudio();       // a custom player (e.g. device voices) may be supplied
  var holder = { avatar: null };
  var panel = new InstructorPanel(root, Object.assign({}, options, { audio: audio, avatar: null }));
  var mount = panel.stage;
  var ready = import(/* @vite-ignore */ options.threeDepsUrl || './three-deps.js').then(function (m) {
    var backend = m.createThreeBackend({ framing: options.framing });
    var avatar = new AIInstructorAvatar(mount, options, backend);
    holder.avatar = avatar; avatar.attachAudio(audio);
    panel.avatar = avatar;
    avatar.on('state', function (e) { panel._renderState(e.state); });
    avatar.on('loadstate', function (e) { panel._renderLoad(e); });
    avatar.on('error', function (e) { panel.showError(panel._friendly(e)); });
    avatar.on('fallback', function () { panel._showFallback(); });
    avatar.on('fallbacklevel', function (e) { panel.fallback.style.setProperty('--lvl', String(e.level)); });
    avatar.on('progress', function (p) { panel.barFill.style.width = Math.round(p * 100) + '%'; panel.overlayText.textContent = 'Loading instructor… ' + Math.round(p * 100) + '%'; });
    return avatar.start().then(function () { return avatar; });
  }, function (err) {
    panel._showFallback(); panel.showError('The animated instructor could not start. You can still learn here using the text box below.');
    throw err;
  });
  return {
    get avatar() { return holder.avatar; }, audio: audio, panel: panel, ready: ready,
    dispose: function () { if (holder.avatar) holder.avatar.dispose(); audio.dispose(); panel.dispose(); }
  };
}
