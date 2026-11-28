/* ============================================================================
 * px-camera.js - MacroNations Proctor camera module (step 4)
 * ----------------------------------------------------------------------------
 * Loaded on demand by px-proctor.js only when an exam uses the camera
 * (settings.camera_mode 'flag' or 'block'), so camera-free exams pay nothing.
 *
 * Everything is analysed ON THE STUDENT'S DEVICE: face count, phone in view,
 * covered/blank camera, sustained talking. The server receives only events,
 * plus small evidence files written straight to private storage:
 *   photo-<t>.jpg   every photo_interval_sec (default 45 s) and on every flag
 *   clip-<t>.webm   9-second clip on serious flags (max clips_per_session, 8)
 *   id-<t>.jpg      ID photo at check-in
 *   room-<t>.webm   room scan at check-in (15 s)
 *   cam-/screen-<t>-<n>.webm   premium plan only: continuous low-res recording
 *
 * Face/phone detection uses Google MediaPipe Tasks (Apache-2.0), fetched from a
 * public CDN the first time it is needed. If it cannot load, the module keeps
 * taking photos and clips and the instructor reviews them by eye.
 *
 * Safari-safe ES5 (the MediaPipe loader runs in its own <script type=module>).
 * ==========================================================================*/
var PXCamera = (function () {
  'use strict';
  var VERSION = 'px-camera-2026-11-step4b';
  var MP_VER = '0.10.14';
  var MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VER;
  var FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
  var OBJ_MODEL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite';

  var K = null;   // context from px-proctor.js
  var V = null;   // live state

  function $(id) { return document.getElementById(id); }
  function now() { return Date.now(); }
  function setting(name, dflt) { var v = K.settings ? K.settings[name] : undefined; return (v === undefined || v === null) ? dflt : v; }

  // --------------------------------------------------------------- upload --
  function upload(blob, name) {
    if (!blob || !K) { return Promise.resolve(false); }
    return new Promise(function (r) { r(K.token ? K.token() : null); }).then(null, function () { return null; }).then(function (tok) {
      var h = { 'apikey': K.anonKey, 'Content-Type': blob.type || 'application/octet-stream', 'x-upsert': 'false' };
      if (tok && typeof tok === 'string') { h.Authorization = 'Bearer ' + tok; }
      return fetch(K.url.replace(/\/+$/, '') + '/storage/v1/object/' + K.bucket + '/' + K.prefix + name,
                   { method: 'POST', headers: h, body: blob });
    }).then(function (r) {
      if (!r.ok) { throw new Error('upload ' + r.status); }
      V.uploaded++;
      return true;
    }).then(null, function (e) {
      V.uploadFails++;
      if (V.uploadFails === 1 || V.uploadFails % 10 === 0) { K.record('evidence_upload_failed', { file: name.split('-')[0], count: V.uploadFails }); }
      return false;
    });
  }

  function stamp() { return String(now()); }

  // Resolves once the camera is delivering frames (or after `ms`).
  function ready(ms) {
    return new Promise(function (resolve) {
      var t0 = now();
      (function poll() {
        if (!V || !V.video) { resolve(false); return; }
        if (V.video.readyState >= 2 && V.video.videoWidth > 0) { resolve(true); return; }
        if (now() - t0 > ms) { resolve(false); return; }
        setTimeout(poll, 100);
      })();
    });
  }

  function photo(prefix) {
    if (!V || !V.video) { return Promise.resolve(null); }
    if (V.video.readyState < 2) {
      return prefix === 'photo' ? Promise.resolve(null) : ready(4000).then(function (okay) { return okay ? photo(prefix) : null; });
    }
    var c = V.canvas, g = c.getContext('2d');
    g.drawImage(V.video, 0, 0, c.width, c.height);
    return new Promise(function (resolve) {
      c.toBlob(function (blob) {
        var name = (prefix || 'photo') + '-' + stamp() + '.jpg';
        upload(blob, name).then(function (ok) { resolve(ok ? name : null); });
      }, 'image/jpeg', 0.6);
    });
  }

  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) { return null; }
    var list = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    for (var i = 0; i < list.length; i++) { if (MediaRecorder.isTypeSupported(list[i])) { return list[i]; } }
    return null;
  }
  function ext(mime) { return mime && mime.indexOf('mp4') !== -1 ? 'mp4' : 'webm'; }

  // Record a short clip from a stream; resolves with the stored name (or null).
  function recordClip(stream, ms, prefix) {
    var mime = pickMime();
    if (!mime || !stream) { return Promise.resolve(null); }
    return new Promise(function (resolve) {
      var chunks = [], rec;
      try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 250000, audioBitsPerSecond: 32000 }); }
      catch (e) { resolve(null); return; }
      rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) { chunks.push(ev.data); } };
      rec.onstop = function () {
        var blob = new Blob(chunks, { type: mime.split(';')[0] });
        var name = prefix + '-' + stamp() + '.' + ext(mime);
        upload(blob, name).then(function (ok) { resolve(ok ? name : null); });
      };
      rec.start();
      setTimeout(function () { try { rec.stop(); } catch (e2) { resolve(null); } }, ms);
    });
  }

  // ----------------------------------------------------------- evidence on flags --
  var CLIP_KINDS = { tab_hidden: 1, focus_lost_long: 1, multiple_faces: 1, phone_detected: 1, no_face: 1,
                     voice_detected: 1, camera_blocked: 1, synthetic_input: 1, canary_triggered: 1, automation_detected: 1 };
  function onFlag(kind) {
    if (!V || !V.active) { return; }
    photo('photo');
    if (!CLIP_KINDS[kind] || V.clipsLeft <= 0 || V.clipBusy || now() - V.lastClip < 30000) { return; }
    V.clipBusy = true; V.clipsLeft--; V.lastClip = now();
    recordClip(V.stream, 9000, 'clip').then(function (name) {
      V.clipBusy = false;
      if (name && V.active) { K.record('evidence_saved', { reason: kind, file: name }); }
    });
  }

  // --------------------------------------------------------------- checks --
  function frameStats() {
    var c = V.small, g = c.getContext('2d');
    try { g.drawImage(V.video, 0, 0, c.width, c.height); } catch (e) { return null; }
    var d = g.getImageData(0, 0, c.width, c.height).data, n = d.length / 4, sum = 0, sq = 0, i, y;
    for (i = 0; i < d.length; i += 4) { y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; sum += y; sq += y * y; }
    var mean = sum / n;
    return { mean: mean, sd: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
  }

  // A condition must hold for `need` checks in a row before it is reported, and
  // is reported once per episode.
  function episode(key, on, need, kind, detail) {
    if (on) {
      V.run[key] = (V.run[key] || 0) + 1;
      if (V.run[key] === need) { K.record(kind, detail || {}); }
    } else { V.run[key] = 0; }
  }

  function check() {
    if (!V || !V.active || !V.video || V.video.readyState < 2) { return; }
    var st = frameStats();
    if (st) { episode('dark', st.mean < 14 || st.sd < 3.5, 3, 'camera_blocked', { brightness: Math.round(st.mean), contrast: Math.round(st.sd) }); }
    if (!V.vision) { return; }
    V.tick++;
    try {
      var faces = V.vision.faces(V.video);
      if (typeof faces === 'number') {
        episode('noface', faces === 0, 3, 'no_face');
        episode('multi', faces > 1, 2, 'multiple_faces', { faces: faces });
      }
      if (V.tick % 2 === 0 && V.vision.phone) {
        var ph = V.vision.phone(V.video);
        if (typeof ph === 'number') { episode('phone', ph >= 0.5, 2, 'phone_detected', { score: Math.round(ph * 100) / 100 }); }
      }
    } catch (e) { /* a failed detection is not evidence of anything */ }
  }

  function loadVision() {
    if (setting('detection', true) === false) { return Promise.resolve(null); }
    if (window.__pxFakeVision) { return Promise.resolve(window.__pxFakeVision); }       // tests
    if (window.__pxVision) { return Promise.resolve(window.__pxVision); }
    return new Promise(function (resolve) {
      var done = false;
      window.__pxVisionCallback = function (v) { if (!done) { done = true; resolve(v); } };
      var s = document.createElement('script');
      s.type = 'module';
      s.textContent =
        'import { FilesetResolver, FaceDetector, ObjectDetector } from "' + MP_BASE + '/vision_bundle.mjs";\n' +
        'try {\n' +
        '  const files = await FilesetResolver.forVisionTasks("' + MP_BASE + '/wasm");\n' +
        '  const face = await FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: "' + FACE_MODEL + '" }, runningMode: "VIDEO", minDetectionConfidence: 0.5 });\n' +
        '  let obj = null;\n' +
        '  try { obj = await ObjectDetector.createFromOptions(files, { baseOptions: { modelAssetPath: "' + OBJ_MODEL + '" }, runningMode: "VIDEO", scoreThreshold: 0.35, categoryAllowlist: ["cell phone"] }); } catch (e) {}\n' +
        '  let t = 0;\n' +
        '  const ts = () => { const n = performance.now(); t = n > t ? n : t + 1; return t; };\n' +
        '  window.__pxVision = {\n' +
        '    faces: (v) => face.detectForVideo(v, ts()).detections.length,\n' +
        '    phone: obj ? (v) => { const r = obj.detectForVideo(v, ts()).detections; let m = 0; for (const d of r) { for (const c of d.categories) { if (c.score > m) m = c.score; } } return m; } : null\n' +
        '  };\n' +
        '  window.__pxVisionCallback(window.__pxVision);\n' +
        '} catch (e) { window.__pxVisionCallback(null); }\n';
      s.onerror = function () { if (!done) { done = true; resolve(null); } };
      document.head.appendChild(s);
      setTimeout(function () { if (!done) { done = true; resolve(null); } }, 25000);
    });
  }

  // ----------------------------------------------------------------- voice --
  function startVoice(stream) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !stream.getAudioTracks().length) { return; }
    try {
      var ctx = new AC(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 1024; src.connect(an);
      V.audio = { ctx: ctx, an: an, buf: new Float32Array(an.fftSize), since: 0, last: 0 };
      V.timers.push(setInterval(function () {
        var a = V.audio, s = 0, i;
        a.an.getFloatTimeDomainData(a.buf);
        for (i = 0; i < a.buf.length; i++) { s += a.buf[i] * a.buf[i]; }
        var rms = Math.sqrt(s / a.buf.length);
        if (rms > 0.045) {
          if (!a.since) { a.since = now(); }
          if (now() - a.since > 2500 && now() - a.last > 20000) { a.last = now(); K.record('voice_detected', { level: Math.round(rms * 1000) / 1000 }); }
        } else { a.since = 0; }
      }, 250));
    } catch (e) { /* no audio analysis on this browser */ }
  }

  // ------------------------------------------------------- premium recording --
  function continuous(stream, prefix, bitrate) {
    var mime = pickMime(); if (!mime || !stream) { return null; }
    var n = 0, rec;
    try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 24000 }); }
    catch (e) { return null; }
    rec.ondataavailable = function (ev) {
      if (ev.data && ev.data.size) { n++; upload(new Blob([ev.data], { type: mime.split(';')[0] }), prefix + '-' + stamp() + '-' + n + '.' + ext(mime)); }
    };
    rec.start(60000);
    return rec;
  }

  function startScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      return Promise.reject(new Error('This browser cannot share the screen.'));
    }
    return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2, displaySurface: 'monitor' }, audio: false })
      .then(function (s) {
        var tr = s.getVideoTracks()[0], set = tr && tr.getSettings ? tr.getSettings() : {};
        V.screen = s;
        K.record('screen_share_started', { surface: set.displaySurface || null });
        if (set.displaySurface && set.displaySurface !== 'monitor') { K.record('screen_share_partial', { surface: set.displaySurface }); }
        tr.onended = function () {
          if (V && V.active) {
            K.record('screen_share_stopped');
            K.overlay('Screen sharing stopped', 'This exam records your screen. Sharing stopped and this was recorded.', 'Share entire screen again',
                      function () { startScreen().then(function () { V.screenRec = continuous(V.screen, 'screen', 200000); }, function () {}); });
          }
        };
        return s;
      });
  }

  // ------------------------------------------------------------ check-in UI --
  function panel(html) {
    var d = $('pxCheckin');
    if (!d) {
      d = document.createElement('div'); d.id = 'pxCheckin';
      d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
      d.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483646;background:rgba(8,6,20,.95);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;color:#e9e4ff;';
      document.body.appendChild(d);
    }
    d.innerHTML = '<div style="max-width:480px;width:92vw;text-align:center;padding:20px;">' + html + '</div>';
    var slot = $('pxCheckinVideo');
    if (slot && V.preview) { slot.appendChild(V.preview); }
    return d;
  }
  function btn(id, label, primary) {
    return '<button id="' + id + '" style="margin:6px;cursor:pointer;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;' +
      (primary ? 'border:none;background:#7c5cff;color:#fff;' : 'border:1px solid #6b5fa0;background:transparent;color:#e9e4ff;') + '">' + label + '</button>';
  }
  function step(title, text, buttons) {
    return '<div style="font-size:18px;font-weight:700;margin-bottom:6px;">' + title + '</div>' +
      '<div style="font-size:13px;color:#b3a9d6;margin-bottom:12px;">' + text + '</div>' +
      '<div id="pxCheckinVideo" style="display:flex;justify-content:center;margin-bottom:12px;"></div>' + buttons;
  }
  function on(id, fn) { var b = $(id); if (b) { b.addEventListener('click', fn); } }

  function checkIn() {
    var needId = setting('id_check', true) !== false;
    var room = setting('room_scan', 'optional');          // 'required' | 'optional' | 'off'
    var premium = !!K.settings.premium_recording;
    return new Promise(function (resolve) {
      function close() { var d = $('pxCheckin'); if (d && d.parentNode) { d.parentNode.removeChild(d); } dock(); resolve(); }
      // Last step: one click that also puts the exam in fullscreen (needs a user gesture).
      function finish() {
        panel(step('All set', 'Your camera is on. The exam opens in fullscreen; stay in it until you submit.',
                   btn('pxGo', 'Start exam', true)));
        on('pxGo', function () { if (K.ready) { K.ready(); } close(); });
      }
      function screenStep() {
        if (!premium) { finish(); return; }
        panel(step('Share your entire screen', 'This exam records your screen at low resolution. Choose <b>Entire screen</b> in the next window.',
                   btn('pxShare', 'Share entire screen', true)));
        on('pxShare', function () {
          startScreen().then(function () { V.screenRec = continuous(V.screen, 'screen', 200000); finish(); },
                             function () { K.record('screen_share_stopped', { at: 'check-in' }); screenStep(); });
        });
      }
      function roomStep() {
        if (room === 'off') { screenStep(); return; }
        panel(step('Room scan', 'Slowly turn your camera (or laptop) to show the whole room and your desk. Recording lasts 15 seconds.',
                   btn('pxRoom', 'Start 15-second room scan', true) + (room === 'required' ? '' : btn('pxRoomSkip', 'Skip', false))));
        on('pxRoomSkip', function () { K.record('room_scan_skipped'); screenStep(); });
        on('pxRoom', function () {
          var b = $('pxRoom'); if (b) { b.disabled = true; b.textContent = 'Recording…'; }
          recordClip(V.stream, 15000, 'room').then(function (name) {
            if (name) { K.record('room_scan_done', { file: name }); } else { K.record('room_scan_skipped', { reason: 'could not record' }); }
            screenStep();
          });
        });
      }
      function idStep() {
        if (!needId) { roomStep(); return; }
        panel(step('Show your ID', 'Hold your student ID (or photo ID) next to your face so both are clearly visible, then take the photo.',
                   btn('pxId', 'Take ID photo', true)));
        on('pxId', function () {
          var b = $('pxId'); if (b) { b.disabled = true; }
          photo('id').then(function (name) { K.record('id_captured', { file: name }); roomStep(); });
        });
      }
      idStep();
    });
  }

  // Small live preview in the corner during the exam.
  function dock() {
    var d = document.createElement('div'); d.id = 'pxCam';
    d.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:2147483644;background:#0c0a18;border:1px solid #3a2f60;border-radius:10px;padding:5px;';
    V.preview.style.cssText = 'width:120px;height:90px;border-radius:8px;object-fit:cover;display:block;';
    d.appendChild(V.preview);
    var l = document.createElement('div');
    l.style.cssText = 'font:600 9px/1.3 system-ui;color:#9b87e0;text-align:center;margin-top:3px;';
    l.textContent = '🔴 Camera and sound monitored';
    d.appendChild(l); document.body.appendChild(d);
  }

  // ------------------------------------------------------------- lifecycle --
  // ctx: { url, anonKey, token(), bucket, prefix, settings, record(kind, detail), overlay(...) }
  function begin(ctx) {
    K = ctx;
    V = { active: true, timers: [], run: {}, tick: 0, uploaded: 0, uploadFails: 0,
          clipsLeft: setting('clips_per_session', 8), clipBusy: false, lastClip: 0, vision: null };
    var mode = setting('camera_mode', 'flag');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      K.record('camera_denied', { reason: 'unsupported browser' });
      return mode === 'block' ? Promise.reject(new Error('This exam needs a camera, and this browser cannot use one.')) : Promise.resolve(false);
    }
    return navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, frameRate: 15 }, audio: true })
      .then(null, function () { return navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false }); })
      .then(function (stream) {
        V.stream = stream;
        var v = document.createElement('video'); v.muted = true; v.autoplay = true; v.playsInline = true;
        v.setAttribute('playsinline', ''); v.srcObject = stream;
        V.video = v;
        V.preview = document.createElement('video'); V.preview.muted = true; V.preview.autoplay = true; V.preview.playsInline = true;
        V.preview.setAttribute('playsinline', ''); V.preview.srcObject = stream;
        V.preview.style.cssText = 'width:320px;max-width:80vw;border-radius:10px;background:#000;';
        try { v.play(); V.preview.play(); } catch (e) { /* autoplay */ }
        V.canvas = document.createElement('canvas'); V.canvas.width = 320; V.canvas.height = 240;
        V.small = document.createElement('canvas'); V.small.width = 64; V.small.height = 48;
        var tr = stream.getVideoTracks()[0];
        if (tr) { tr.onended = function () { if (V && V.active) { K.record('camera_off'); } }; }
        K.record('camera_started', { audio: stream.getAudioTracks().length > 0 });
        startVoice(stream);
        loadVision().then(function (vis) { if (V) { V.vision = vis; } });
        return checkIn().then(function () {
          photo('photo');
          V.timers.push(setInterval(function () { photo('photo'); }, Math.max(15, setting('photo_interval_sec', 45)) * 1000));
          V.timers.push(setInterval(check, 4000));
          if (K.settings.premium_recording) { V.camRec = continuous(stream, 'cam', 150000); }
          return true;
        });
      }, function (err) {
        K.record('camera_denied', { reason: (err && err.name) || 'denied' });
        if (mode === 'block') { throw new Error('This exam needs your camera. Allow camera access and start again.'); }
        return false;
      });
  }

  function stop() {
    if (!V) { return; }
    V.active = false;
    var i;
    for (i = 0; i < V.timers.length; i++) { clearInterval(V.timers[i]); }
    try { if (V.camRec && V.camRec.state !== 'inactive') { V.camRec.stop(); } } catch (e) { /* ignore */ }
    try { if (V.screenRec && V.screenRec.state !== 'inactive') { V.screenRec.stop(); } } catch (e2) { /* ignore */ }
    var streams = [V.stream, V.screen];
    setTimeout(function () {     // let the last recording chunk flush first
      for (var j = 0; j < streams.length; j++) {
        if (streams[j]) { streams[j].getTracks().forEach(function (t) { try { t.stop(); } catch (e3) { /* ignore */ } }); }
      }
    }, 800);
    try { if (V.audio && V.audio.ctx) { V.audio.ctx.close(); } } catch (e4) { /* ignore */ }
    var d = $('pxCam'); if (d && d.parentNode) { d.parentNode.removeChild(d); }
    var c = $('pxCheckin'); if (c && c.parentNode) { c.parentNode.removeChild(c); }
  }

  return { version: VERSION, begin: begin, stop: stop, onFlag: onFlag,
           _state: function () { return V ? { uploaded: V.uploaded, failed: V.uploadFails, vision: !!V.vision, clipsLeft: V.clipsLeft } : null; } };
})();
if (typeof module !== 'undefined' && module.exports) { module.exports = PXCamera; }
