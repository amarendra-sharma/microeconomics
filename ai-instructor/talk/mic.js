// mic.js - microphone permission probe. Opens the mic only to learn whether access is possible,
// then stops every track immediately. Real capture arrives with the voice subsystem (Prompt 4).
// status: 'ready' | 'denied' | 'unavailable' | 'busy' | 'error'
export function requestMicPermission(nav) {
  nav = nav || (typeof navigator !== 'undefined' ? navigator : null);
  if (!nav || !nav.mediaDevices || typeof nav.mediaDevices.getUserMedia !== 'function') {
    return Promise.resolve({ status: 'unavailable', message: 'This browser cannot access a microphone (or the page is not served over HTTPS).' });
  }
  return nav.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    var tracks = stream.getTracks ? stream.getTracks() : [];
    for (var i = 0; i < tracks.length; i++) { try { tracks[i].stop(); } catch (e) { /* ignore */ } }
    return { status: 'ready', message: 'Microphone ready.' };
  }, function (err) {
    var name = err && err.name ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
      return { status: 'denied', message: 'Microphone access was blocked. Allow it in the browser address bar, or use the text box.' };
    if (name === 'NotFoundError' || name === 'OverconstrainedError')
      return { status: 'unavailable', message: 'No microphone was found. Use the text box instead.' };
    if (name === 'NotReadableError' || name === 'AbortError')
      return { status: 'busy', message: 'The microphone is in use by another application.' };
    return { status: 'error', message: 'The microphone could not be started. Use the text box instead.' };
  });
}
