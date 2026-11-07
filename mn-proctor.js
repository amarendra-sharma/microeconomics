/* ============================================================================
 * mn-proctor.js  -  MacroNations shared proctoring engine
 * ----------------------------------------------------------------------------
 * One portable soft-proctoring module used by every MacroNations module
 * (StrategyArena, Macroeconomics, EconometriQ, and future subjects). Fix a bug
 * or change a policy HERE and every module that loads this file benefits.
 *
 * IMPORTANT - what this is and isn't:
 *   This is BROWSER-BASED soft proctoring. It deters and records; it does NOT
 *   physically lock the computer (only installed software like Respondus can).
 *   It enforces fullscreen, detects tab/window switches and focus loss, blocks
 *   copy/paste/right-click, runs a camera check-in (ID + materials), stores a
 *   snapshot when a rule is broken, and auto-submits after repeated violations.
 *
 * Safari-safe: no optional chaining, no nullish coalescing, no template
 * literals, var declarations, explicit null checks. (MacroNations convention.)
 *
 * ----------------------------------------------------------------------------
 * QUICK INTEGRATION (per app):
 *
 *   1. Load this file:  <script src="mn-proctor.js"></script>
 *   2. Run mn_proctor_schema.sql once in THAT app's Supabase project.
 *   3. Initialize after your Supabase client exists:
 *        MNProctor.init({ sb: sb, bucket: 'proctor-snapshots' });
 *   4. Before an exam starts, gate it through consent:
 *        MNProctor.runConsent(examCfg, hostEl, function(){ startMyExam(); },
 *                             function(){ backToList(); });
 *   5. When the exam actually begins, start monitoring:
 *        MNProctor.start(examCfg, { id: userId });
 *   6. When the exam submits (manual OR auto), tear down + save:
 *        MNProctor.finish();      // awaits the save
 *   7. Tell the engine what to do on auto-submit:
 *        MNProctor.onAutoSubmit(function(){ submitMyExam(true); });
 *   8. Instructor integrity viewer:
 *        MNProctor.renderIntegrityLog(examId, hostEl, courseOwnerCheck);
 *
 *   examCfg shape: { id, course_id, proctored (bool), camera_mode:'off'|'flag'|'block' }
 * ==========================================================================*/

var MNProctor = (function () {
  var SB = null;
  var BUCKET = 'proctor-snapshots';
  var TABLE = 'mn_proctor_events';
  var PROFILES = 'sa_profiles';
  var autoSubmitCb = null;

  var S = {
    active: false, violations: 0, events: [], maxBeforeSubmit: 4, lastFlagAt: 0,
    awayTimer: null, startedAt: 0,
    banner: null, handlers: {}, exam: null, user: null,
    cam: { stream: null, video: null, canvas: null, faceDetector: null, faceTimer: null, thumb: null, ready: false },
    audio: { ctx: null, analyser: null, data: null, timer: null, speakingSince: 0, lastVoiceFlag: 0 },
    rec: { recording: false },
    lastError: null, lastSnapError: null
  };
  // tuning knobs
  var VOICE_THRESHOLD = 0.045;   // RMS above this = sound present (0..1)
  var VOICE_SUSTAIN_MS = 2500;   // must be sustained this long to count as talking
  var VOICE_COOLDOWN_MS = 20000; // min gap between voice flags (avoids spamming)
  var CLIP_MS = 9000;            // length of a recorded clip
  var RETENTION_DAYS = 30;       // clips/snapshots auto-deleted after this

  function $(id){ return document.getElementById(id); }
  function esc(s){ if(s===null||s===undefined){return '';} return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // -- public: one-time init -------------------------------------------------
  function init(opts){
    if(!opts || !opts.sb){ throw new Error('MNProctor.init needs { sb }'); }
    SB = opts.sb;
    if(opts.bucket){ BUCKET = opts.bucket; }
    if(opts.table){ TABLE = opts.table; }
    if(opts.maxBeforeSubmit){ S.maxBeforeSubmit = Number(opts.maxBeforeSubmit); }
    if(opts.profilesTable){ PROFILES = opts.profilesTable; }
    if(typeof opts.maxBeforeSubmit === 'number'){ S.maxBeforeSubmit = opts.maxBeforeSubmit; }
  }
  function onAutoSubmit(cb){ autoSubmitCb = cb; }

  function camMode(){ return (S.exam && S.exam.camera_mode) ? S.exam.camera_mode : 'off'; }
  function proctored(){ return !!(S.exam && S.exam.proctored !== false); }

  // -- consent + ID/materials check-in --------------------------------------
  function runConsent(exam, hostEl, onBegin, onCancel){
    S.exam = exam;
    var cam = exam.camera_mode && exam.camera_mode !== 'off';
    if(!proctored()){ if(onBegin){ onBegin(); } return; }
    var rules = '';
    rules += '<li>Stay in this browser window and in fullscreen for the whole exam.</li>';
    rules += '<li>Do <b>not</b> open another window or tab, switch apps, or minimize.</li>';
    rules += '<li>Copy, paste, and right-click are disabled.</li>';
    if(cam){
      rules += '<li>Your webcam <b>and microphone</b> stay on. A photo is saved when a rule is broken, and a short <b>video clip</b> is recorded if talking is detected during the exam.' + (exam.camera_mode==='block'?' A working camera is required to start.':'') + '</li>';
      rules += '<li>Hold your <b>photo ID</b> up to the camera and capture it below before starting.</li>';
      rules += '<li>If you are using a <b>calculator</b>, show it to the camera now.</li>';
      rules += '<li>One <b>blank sheet</b> for rough work is allowed \u2014 show both sides to the camera to prove it is blank before you begin.</li>';
    }
    rules += '<li>Leaving the exam is recorded. Repeated violations will <b>submit your exam automatically</b>.</li>';

    var idBlock = cam ?
      ('<div style="background:rgba(0,0,0,.18);border:1px solid rgba(128,128,128,.3);border-radius:8px;padding:12px;margin:6px 0 14px;">'+
        '<div style="font-size:13px;font-weight:700;margin-bottom:8px;">Camera check-in</div>'+
        '<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;">'+
          '<div><video id="mnpVideo" autoplay muted playsinline style="width:200px;height:150px;background:#000;border-radius:8px;object-fit:cover;"></video>'+
            '<div id="mnpStatus" style="font-size:11.5px;opacity:.75;margin-top:5px;">Starting camera\u2026</div></div>'+
          '<div style="flex:1;min-width:160px;font-size:12.5px;opacity:.8;">'+
            '<div style="margin-bottom:8px;">1. Hold your photo ID steady, facing the camera.</div>'+
            '<div style="margin-bottom:8px;">2. Click <b>Capture ID</b> \u2014 the image is saved for your instructor.</div>'+
            '<div style="margin-bottom:8px;">3. Briefly show your calculator (if any) and a blank sheet of scratch paper.</div>'+
            '<button id="mnpCapture" style="cursor:pointer;padding:7px 12px;border-radius:7px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;font-size:12.5px;margin-top:6px;">\uD83D\uDCF7 Capture ID</button>'+
            '<div id="mnpCaptured" style="font-size:12px;color:#2ec27e;margin-top:6px;"></div>'+
          '</div>'+
        '</div>'+
      '</div>') : '';

    hostEl.innerHTML =
      '<div style="max-width:640px;margin:0 auto;border:1px solid rgba(128,128,128,.25);border-radius:12px;padding:20px;">'+
        '<h2 style="font-size:22px;margin:0 0 6px;">Before you begin \u2014 proctored exam</h2>'+
        '<p style="font-size:13.5px;opacity:.75;margin-bottom:12px;">This exam is monitored to protect academic integrity. Please read the rules:</p>'+
        '<ul style="font-size:14px;line-height:1.7;padding-left:20px;margin-bottom:8px;">'+rules+'</ul>'+
        idBlock+
        '<div style="background:rgba(0,0,0,.15);border:1px solid rgba(128,128,128,.25);border-radius:8px;padding:10px 12px;font-size:12.5px;opacity:.8;margin:6px 0 16px;">Note: this is browser-based monitoring. It records and reacts to violations but does not physically lock your computer. By starting, you consent to this monitoring'+(cam?' and to webcam photos, your ID photo, and short video clips (with audio, recorded if talking is detected) being stored and reviewed by your instructor. Recordings are automatically deleted after 30 days':'')+'.</div>'+
        '<div style="display:flex;justify-content:flex-end;gap:10px;">'+
          '<button id="mnpCancel" style="cursor:pointer;padding:8px 14px;border-radius:7px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;">Cancel</button>'+
          '<button id="mnpBegin" style="cursor:pointer;padding:8px 16px;border-radius:7px;border:none;background:#7c5cff;color:#fff;font-weight:600;'+(cam && exam.camera_mode==='block'?'opacity:.5;':'')+'"'+(cam && exam.camera_mode==='block'?' disabled':'')+'>I understand \u2014 begin exam</button>'+
        '</div>'+
      '</div>';

    $('mnpCancel').addEventListener('click', function(){ stopConsentCam(); if(onCancel){ onCancel(); } });
    $('mnpBegin').addEventListener('click', function(){ stopConsentCam(); if(onBegin){ onBegin(); } });

    if(cam && navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
      navigator.mediaDevices.getUserMedia({ video:{ width:320, height:240 }, audio:false }).then(function(stream){
        window.__mnpConsentStream = stream;
        var v=$('mnpVideo'); if(v){ v.srcObject=stream; }
        if($('mnpStatus')){ $('mnpStatus').textContent='Camera on. Capture your ID to continue.'; }
        if($('mnpCapture')){
          $('mnpCapture').addEventListener('click', function(){
            try{
              var c=document.createElement('canvas'); c.width=320; c.height=240;
              c.getContext('2d').drawImage(v,0,0,320,240);
              c.toBlob(function(blob){
                if(!blob || !window.__mnpUserId){ return; }
                var path=exam.id + '/' + window.__mnpUserId + '/ID_' + Date.now() + '.jpg';
                SB.storage.from(BUCKET).upload(path, blob, { contentType:'image/jpeg', upsert:true }).then(function(r){
                  if(r && r.error){ if($('mnpCaptured')){ $('mnpCaptured').style.color='#e5484d'; $('mnpCaptured').textContent='Upload failed: '+r.error.message; } return; }
                  if($('mnpCaptured')){ $('mnpCaptured').textContent='\u2713 ID captured. You may begin.'; }
                  var bb=$('mnpBegin'); if(bb){ bb.disabled=false; bb.style.opacity='1'; }
                }, function(){ if($('mnpCaptured')){ $('mnpCaptured').style.color='#e5484d'; $('mnpCaptured').textContent='Upload error.'; } });
              }, 'image/jpeg', 0.7);
            }catch(e){}
          });
        }
      }, function(){
        if($('mnpStatus')){ $('mnpStatus').textContent='Camera blocked. Enable camera access to take this exam.'; }
        if(exam.camera_mode!=='block'){ var bb=$('mnpBegin'); if(bb){ bb.disabled=false; bb.style.opacity='1'; } }
      });
    }
  }
  function stopConsentCam(){
    if(window.__mnpConsentStream){ window.__mnpConsentStream.getTracks().forEach(function(t){ try{t.stop();}catch(e){} }); window.__mnpConsentStream=null; }
  }

  // -- monitoring ------------------------------------------------------------
  function start(exam, user){
    S.exam = exam; S.user = user;
    window.__mnpUserId = user ? user.id : null;
    if(!proctored()){ return; }
    S.active=true; S.violations=0; S.events=[]; S.lastFlagAt=0; S.startedAt=Date.now();
    goFullscreen();
    var b=document.createElement('div'); b.id='mnpBanner';
    b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;background:#1a1430;color:#cdbcff;border-bottom:1px solid #3a2f60;font:600 12px/1.4 system-ui,sans-serif;padding:7px 14px;display:flex;justify-content:space-between;align-items:center;';
    var label = (exam && exam.sessionLabel) ? exam.sessionLabel : 'exam';
    b.innerHTML='<span>\uD83D\uDD12 Proctored ' + label + ' in progress \u2014 stay in fullscreen; leaving this tab is recorded.</span><span id="mnpCount" style="color:#9b87e0;"></span>';
    document.body.appendChild(b); S.banner=b;

    S.handlers.vis=function(){ if(document.hidden){ flag('left the exam tab / minimized'); } };
    // A raw window blur is a WEAK signal. It also fires while the page is still
    // fully visible and the student has gone nowhere: camera/mic permission
    // prompts, OS notifications, password managers, native dropdowns, clicks on
    // a second monitor, the screen dimming. Counting those immediately was
    // auto-submitting honest students.
    //
    // Every blur is still recorded for the integrity log, but it only becomes a
    // COUNTED violation if the student does not come back within AWAY_MS. A real
    // tab switch or minimise is caught immediately by visibilitychange above.
    S.handlers.blur=function(){
      if(!S.active){ return; }
      note('focus left the exam window (brief)');
      if(S.awayTimer){ clearTimeout(S.awayTimer); }
      S.awayTimer=setTimeout(function(){
        S.awayTimer=null;
        if(S.active && !document.hasFocus() && !document.hidden){
          flag('away from the exam window');
        }
      }, 8000);
    };
    S.handlers.focus=function(){
      if(S.awayTimer){ clearTimeout(S.awayTimer); S.awayTimer=null; }
    };
    S.handlers.fs=function(){ if(S.active && !document.fullscreenElement){ flag('exited fullscreen'); askFullscreen(); } };
    S.handlers.copy=function(ev){ ev.preventDefault(); flag('copy blocked'); };
    S.handlers.paste=function(ev){ ev.preventDefault(); flag('paste blocked'); };
    S.handlers.ctx=function(ev){ ev.preventDefault(); };
    S.handlers.beforeunload=function(ev){ if(S.active){ ev.preventDefault(); ev.returnValue=''; return ''; } };
    document.addEventListener('visibilitychange', S.handlers.vis);
    window.addEventListener('blur', S.handlers.blur);
    window.addEventListener('focus', S.handlers.focus);
    window.addEventListener('beforeunload', S.handlers.beforeunload);
    document.addEventListener('fullscreenchange', S.handlers.fs);
    document.addEventListener('copy', S.handlers.copy);
    document.addEventListener('paste', S.handlers.paste);
    document.addEventListener('contextmenu', S.handlers.ctx);
    startCamera();
  }

  function goFullscreen(){ var el=document.documentElement; if(el.requestFullscreen){ el.requestFullscreen().then(function(){},function(){}); } }
  function askFullscreen(){
    if($('mnpRefs')){ return; }
    var d=document.createElement('div'); d.id='mnpRefs';
    d.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(8,6,20,.92);display:flex;align-items:center;justify-content:center;';
    d.innerHTML='<div style="max-width:420px;text-align:center;color:#e9e4ff;font-family:system-ui,sans-serif;padding:28px;">'+
      '<div style="font-size:18px;font-weight:700;margin-bottom:8px;">Return to fullscreen</div>'+
      '<div style="font-size:13px;color:#b3a9d6;margin-bottom:18px;">This is a proctored exam. Leaving fullscreen has been recorded. Click below to continue.</div>'+
      '<button id="mnpResume" style="background:#7c5cff;color:#fff;border:none;border-radius:8px;padding:11px 20px;font-size:14px;font-weight:600;cursor:pointer;">Resume exam in fullscreen</button></div>';
    document.body.appendChild(d);
    $('mnpResume').addEventListener('click', function(){ goFullscreen(); if(d.parentNode){ document.body.removeChild(d); } });
  }

  // Recorded in the integrity log but NOT counted toward auto-submit. Used for
  // signals that are real but ambiguous, so the instructor still sees them.
  function note(reason){
    if(!S.active){ return; }
    S.events.push({ t:new Date().toISOString(), reason:reason, counted:false });
  }

  function flag(reason){
    if(!S.active){ return; }
    var now=Date.now();
    S.events.push({ t:new Date().toISOString(), reason:reason, counted:true });
    // Voice flags capture a short VIDEO CLIP (to see/hear live-help cheating);
    // all other flags keep the cheap photo snapshot.
    if(S.cam.ready){
      if(reason && reason.indexOf('voice')===0){ recordClip(reason); }
      else { snapshot(reason); }
    }
    // One real action can fire blur AND visibilitychange a few seconds apart.
    // A 1.2s window was too tight and charged students twice for one incident.
    if(S.lastFlagAt && (now - S.lastFlagAt) < 6000){ return; }
    S.lastFlagAt=now;
    S.violations++;
    var c=$('mnpCount'); if(c){ c.textContent='Activity flagged'; }
    if(S.violations < S.maxBeforeSubmit){
      if(S.banner){ S.banner.style.background='#3a1420'; S.banner.firstChild.textContent='\u26A0 Warning: leaving the exam is recorded. Continuing to do so will submit your exam automatically.'; }
      toast('\u26A0 Warning: stay in the exam window. Repeated violations will end and submit your exam.');
    } else if((now - S.startedAt) < 60000){
      // Never auto-submit in the first minute. Permission prompts and window
      // juggling cluster at the start; ending an exam there is almost always
      // wrong. The incidents are still recorded.
      toast('\u26A0 Warning: stay in the exam window.');
    } else {
      flagSubmit();
    }
  }
  function toast(msg){
    var t=document.createElement('div');
    t.style.cssText='position:fixed;top:46px;left:50%;transform:translateX(-50%);z-index:10001;background:#3a1420;color:#ffd9e0;border:1px solid #7a2540;border-radius:8px;padding:11px 18px;font:600 13px/1.4 system-ui,sans-serif;max-width:520px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.5);';
    t.textContent=msg; document.body.appendChild(t);
    setTimeout(function(){ if(t.parentNode){ t.parentNode.removeChild(t); } }, 4500);
  }
  function flagSubmit(){
    persist().then(function(){
      stop();
      if(autoSubmitCb){
        try{ alert('Your exam was auto-submitted after repeated proctoring flags. Your instructor will see the integrity log.'); }catch(e){}
        autoSubmitCb();
      }
    });
  }

  // -- camera ---------------------------------------------------------------
  function startCamera(){
    if(camMode()==='off'){ return; }
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ flag('camera not supported by browser'); return; }
    navigator.mediaDevices.getUserMedia({ video:{ width:320, height:240 }, audio:true }).then(function(stream){
      S.cam.stream=stream;
      var v=document.createElement('video'); v.autoplay=true; v.muted=true; v.playsInline=true; v.srcObject=stream;
      v.style.cssText='width:120px;height:90px;border-radius:8px;object-fit:cover;display:block;';
      S.cam.video=v;
      var c=document.createElement('canvas'); c.width=320; c.height=240; S.cam.canvas=c;
      var thumb=document.createElement('div'); thumb.id='mnpCam';
      thumb.style.cssText='position:fixed;bottom:14px;right:14px;z-index:9999;background:#0c0a18;border:1px solid #3a2f60;border-radius:10px;padding:5px;box-shadow:0 8px 24px rgba(0,0,0,.5);';
      var lbl=document.createElement('div'); lbl.style.cssText='font:600 9px/1.3 system-ui;color:#9b87e0;text-align:center;margin-top:3px;'; lbl.textContent='\uD83D\uDD34 REC \u00b7 audio + video monitored';
      thumb.appendChild(v); thumb.appendChild(lbl); document.body.appendChild(thumb); S.cam.thumb=thumb;
      var track=stream.getVideoTracks()[0];
      if(track){ track.onended=function(){ if(S.active){ flag('camera turned off mid-exam'); } }; }
      if('FaceDetector' in window){ try{ S.cam.faceDetector=new window.FaceDetector({ fastMode:true, maxDetectedFaces:3 }); }catch(e){ S.cam.faceDetector=null; } }
      S.cam.ready=true;
      snapshot('exam start');
      startVoiceDetection(stream);
      if(S.cam.faceDetector){
        S.cam.faceTimer=setInterval(function(){
          if(!S.active || !S.cam.video){ return; }
          S.cam.faceDetector.detect(S.cam.video).then(function(faces){
            if(!faces || faces.length===0){ flag('no face detected'); }
            else if(faces.length>1){ flag('multiple faces detected'); }
          }, function(){});
        }, 8000);
      }
    }, function(){ flag('camera access denied'); });
  }

  // -- audio voice-activity detection (free, in-browser, stores nothing) -----
  function startVoiceDetection(stream){
    try{
      var AC = window.AudioContext || window.webkitAudioContext;
      if(!AC){ return; }                // unsupported browser: skip silently
      if(!stream.getAudioTracks || stream.getAudioTracks().length===0){ return; } // mic denied
      S.audio.ctx = new AC();
      var src = S.audio.ctx.createMediaStreamSource(stream);
      S.audio.analyser = S.audio.ctx.createAnalyser();
      S.audio.analyser.fftSize = 512;
      S.audio.data = new Uint8Array(S.audio.analyser.fftSize);
      src.connect(S.audio.analyser);    // analyser only; NOT connected to output (no echo)
      S.audio.timer = setInterval(pollVoice, 400);
    }catch(e){ try{ console.error('mnproctor audio init failed:', e); }catch(x){} }
  }
  function pollVoice(){
    if(!S.active || !S.audio.analyser){ return; }
    S.audio.analyser.getByteTimeDomainData(S.audio.data);
    // RMS of the waveform around the 128 midpoint, normalized to 0..1
    var sum=0, n=S.audio.data.length;
    for(var i=0;i<n;i++){ var d=(S.audio.data[i]-128)/128; sum += d*d; }
    var rms = Math.sqrt(sum/n);
    var now = Date.now();
    if(rms > VOICE_THRESHOLD){
      if(!S.audio.speakingSince){ S.audio.speakingSince = now; }
      else if((now - S.audio.speakingSince) >= VOICE_SUSTAIN_MS){
        // sustained speech detected
        if((now - S.audio.lastVoiceFlag) >= VOICE_COOLDOWN_MS){
          S.audio.lastVoiceFlag = now;
          S.audio.speakingSince = 0;
          flag('voice activity detected');   // flag() will record a video clip
        }
      }
    } else {
      S.audio.speakingSince = 0;   // silence resets the sustain timer
    }
  }
  function stopVoiceDetection(){
    if(S.audio.timer){ clearInterval(S.audio.timer); S.audio.timer=null; }
    if(S.audio.ctx){ try{ S.audio.ctx.close(); }catch(e){} S.audio.ctx=null; }
    S.audio.analyser=null; S.audio.data=null; S.audio.speakingSince=0; S.audio.lastVoiceFlag=0;
  }

  // -- record a short video clip (used for voice flags) ----------------------
  function recordClip(reason){
    if(S.rec.recording || !S.cam.stream || !S.user || !S.exam){ return; }
    if(typeof MediaRecorder === 'undefined'){ snapshot(reason); return; } // fallback to photo
    var mime = '';
    try{
      if(MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')){ mime='video/webm;codecs=vp9,opus'; }
      else if(MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')){ mime='video/webm;codecs=vp8,opus'; }
      else if(MediaRecorder.isTypeSupported('video/webm')){ mime='video/webm'; }
    }catch(e){}
    var mr;
    try{ mr = mime ? new MediaRecorder(S.cam.stream, { mimeType:mime }) : new MediaRecorder(S.cam.stream); }
    catch(e){ snapshot(reason); return; }
    var chunks=[];
    S.rec.recording = true;
    mr.ondataavailable = function(ev){ if(ev.data && ev.data.size>0){ chunks.push(ev.data); } };
    mr.onstop = function(){
      S.rec.recording = false;
      var blob = new Blob(chunks, { type:'video/webm' });
      if(!blob.size){ return; }
      var path = S.exam.id + '/' + S.user.id + '/CLIP_' + Date.now() + '.webm';
      SB.storage.from(BUCKET).upload(path, blob, { contentType:'video/webm', upsert:true }).then(function(r){
        if(r && r.error){ try{ console.error('mnproctor clip upload failed:', r.error.message); }catch(e){} S.lastSnapError=r.error.message; }
      }, function(e){ try{ console.error('mnproctor clip exception:', e); }catch(x){} });
    };
    try{ mr.start(); }catch(e){ S.rec.recording=false; snapshot(reason); return; }
    setTimeout(function(){ try{ if(mr.state!=='inactive'){ mr.stop(); } }catch(e){ S.rec.recording=false; } }, CLIP_MS);
  }
  function snapshot(reason){
    if(!S.cam.ready || !S.cam.video || !S.cam.canvas){ return; }
    try{
      var ctx=S.cam.canvas.getContext('2d');
      ctx.drawImage(S.cam.video,0,0,S.cam.canvas.width,S.cam.canvas.height);
      S.cam.canvas.toBlob(function(blob){
        if(!blob || !S.user || !S.exam){ return; }
        var path=S.exam.id + '/' + S.user.id + '/' + Date.now() + '.jpg';
        SB.storage.from(BUCKET).upload(path, blob, { contentType:'image/jpeg', upsert:true }).then(function(r){
          if(r && r.error){ try{ console.error('mnproctor snapshot upload failed:', r.error.message); }catch(e){} S.lastSnapError=r.error.message; }
        }, function(e){ try{ console.error('mnproctor snapshot exception:', e); }catch(x){} });
      }, 'image/jpeg', 0.6);
    }catch(e){ try{ console.error('mnproctor snapshot draw error:', e); }catch(x){} }
  }
  function stopCamera(){
    stopVoiceDetection();
    if(S.cam.faceTimer){ clearInterval(S.cam.faceTimer); S.cam.faceTimer=null; }
    if(S.cam.stream){ S.cam.stream.getTracks().forEach(function(t){ try{t.stop();}catch(e){} }); }
    if(S.cam.thumb && S.cam.thumb.parentNode){ S.cam.thumb.parentNode.removeChild(S.cam.thumb); }
    S.cam={ stream:null, video:null, canvas:null, faceDetector:null, faceTimer:null, thumb:null, ready:false };
  }

  // -- teardown + persistence ------------------------------------------------
  function stop(){
    if(!S.active){ return; }
    S.active=false;
    stopCamera();
    document.removeEventListener('visibilitychange', S.handlers.vis);
    window.removeEventListener('blur', S.handlers.blur);
    if(S.handlers.focus){ window.removeEventListener('focus', S.handlers.focus); }
    if(S.awayTimer){ clearTimeout(S.awayTimer); S.awayTimer=null; }
    window.removeEventListener('beforeunload', S.handlers.beforeunload);
    document.removeEventListener('fullscreenchange', S.handlers.fs);
    document.removeEventListener('copy', S.handlers.copy);
    document.removeEventListener('paste', S.handlers.paste);
    document.removeEventListener('contextmenu', S.handlers.ctx);
    if(S.banner && S.banner.parentNode){ S.banner.parentNode.removeChild(S.banner); }
    S.banner=null;
    if($('mnpRefs')){ document.body.removeChild($('mnpRefs')); }
    if(document.fullscreenElement && document.exitFullscreen){ document.exitFullscreen().then(function(){},function(){}); }
  }
  function persist(){
    if(!S.exam){ return Promise.resolve(); }
    // Lightweight sessions (e.g. graded quizzes) set noPersist: there is no
    // sa_exams row to satisfy the exam_id foreign key, so we skip the DB write.
    // The in-page protections (fullscreen, tab/copy blocking, auto-submit) still run.
    if(S.exam.noPersist){ return Promise.resolve(); }
    var rec={ exam_id:S.exam.id, course_id:S.exam.course_id, student_id:S.user?S.user.id:null,
              violations:S.violations, events:JSON.stringify(S.events.slice(0,50)) };
    if(!rec.student_id){ return Promise.resolve(); }
    return SB.from(TABLE).upsert(rec, { onConflict:'exam_id,student_id' }).then(function(r){
      if(r && r.error){ try{ console.error('mnproctor persist failed:', r.error.message); }catch(e){} S.lastError=r.error.message; }
      return r;
    }, function(e){ try{ console.error('mnproctor persist exception:', e); }catch(x){} S.lastError=(e&&e.message)?e.message:'unknown'; });
  }
  // call on any submit (manual or auto). awaits the save.
  function finish(){
    if(!S.active){ return Promise.resolve(); }
    return persist().then(function(){ stop(); });
  }
  function isActive(){ return S.active; }

  // -- instructor integrity viewer ------------------------------------------
  // hostEl: element to render into. Reads events + signed snapshot URLs.
  function renderIntegrityLog(examId, hostEl){
    hostEl.innerHTML='<div style="opacity:.7;font-size:13px;">Loading integrity log\u2026</div>';
    SB.from(TABLE).select('student_id,violations,events,updated_at').eq('exam_id',examId).order('violations',{ascending:false}).then(function(res){
      if(res.error){ hostEl.innerHTML='<div style="opacity:.7;">'+esc(res.error.message)+'</div>'; return; }
      var rows=res.data?res.data:[];
      if(rows.length===0){ hostEl.innerHTML='<div style="opacity:.7;font-size:13px;">No proctoring events recorded yet.</div>'; return; }
      var ids=rows.map(function(r){ return r.student_id; });
      SB.from(PROFILES).select('id,full_name,email').in('id',ids).then(function(pr){
        // profile table name may differ per app; fall back to id if missing
        var nameById={}; if(pr && pr.data){ pr.data.forEach(function(p){ nameById[p.id]=p.full_name||p.email||p.id; }); }
        var html='';
        rows.forEach(function(r){
          var sev = r.violations>=3 ? '#e5484d' : (r.violations>0?'#f5a623':'#2ec27e');
          var evs='';
          try{ var arr=JSON.parse(r.events||'[]'); evs=arr.map(function(e){ return '<div style="font-size:11.5px;opacity:.6;">'+esc((e.t||'').replace('T',' ').slice(0,19))+' \u2014 '+esc(e.reason||'')+'</div>'; }).join(''); }catch(e){ evs=''; }
          html+='<div style="border:1px solid rgba(128,128,128,.25);border-radius:8px;padding:10px;margin-bottom:8px;">'+
            '<div style="display:flex;justify-content:space-between;align-items:center;">'+
              '<div style="font-size:14px;font-weight:600;">'+esc(nameById[r.student_id]||r.student_id)+'</div>'+
              '<span style="background:'+sev+';color:#fff;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600;">'+r.violations+' flag'+(r.violations===1?'':'s')+'</span></div>'+
            (evs?('<div style="margin-top:6px;border-top:1px solid rgba(128,128,128,.2);padding-top:6px;">'+evs+'</div>'):'')+
            '<div class="mnpSnap" data-snap="'+esc(examId)+'/'+esc(r.student_id)+'" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;"></div>'+
          '</div>';
        });
        hostEl.innerHTML=html;
        Array.prototype.forEach.call(hostEl.querySelectorAll('.mnpSnap'), function(w){
          var prefix=w.getAttribute('data-snap');
          SB.storage.from(BUCKET).list(prefix, { limit:100, sortBy:{ column:'name', order:'desc' } }).then(function(lr){
            var files=lr.data?lr.data:[];
            var cutoff = Date.now() - (RETENTION_DAYS*24*60*60*1000);
            var stale=[]; var fresh=[];
            files.forEach(function(f){
              var created = f.created_at ? new Date(f.created_at).getTime() : 0;
              if(created && created < cutoff){ stale.push(prefix+'/'+f.name); } else { fresh.push(f); }
            });
            // 30-day retention: delete anything older than the cutoff
            if(stale.length){ SB.storage.from(BUCKET).remove(stale).then(function(){}, function(){}); }
            fresh.forEach(function(f){
              var full=prefix+'/'+f.name;
              var isClip = f.name.indexOf('CLIP_')===0 || /\.webm$/.test(f.name);
              var isId = f.name.indexOf('ID_')===0;
              SB.storage.from(BUCKET).createSignedUrl(full, 3600).then(function(su){
                if(!(su.data && su.data.signedUrl)){ return; }
                if(isClip){
                  var vid=document.createElement('video');
                  vid.src=su.data.signedUrl; vid.controls=true; vid.preload='metadata';
                  vid.title='voice-flag clip';
                  vid.style.cssText='width:140px;height:105px;object-fit:cover;border-radius:5px;border:2px solid #e5484d;background:#000;cursor:pointer;';
                  w.appendChild(vid);
                } else {
                  var img=document.createElement('img'); img.src=su.data.signedUrl;
                  img.title = isId ? 'ID photo' : 'flag snapshot';
                  img.style.cssText='width:80px;height:60px;object-fit:cover;border-radius:5px;border:'+(isId?'2px solid #f5a623':'1px solid rgba(128,128,128,.4)')+';cursor:pointer;';
                  img.addEventListener('click', function(){ window.open(su.data.signedUrl,'_blank'); });
                  w.appendChild(img);
                }
              });
            });
          });
        });
      });
    });
  }

  // clear log + snapshots for an exam (instructor)
  function clearLog(examId){
    return SB.storage.from(BUCKET).list(examId, { limit:1000 }).then(function(folders){
      var dirs=folders.data?folders.data:[];
      var lists=dirs.map(function(d){
        return SB.storage.from(BUCKET).list(examId+'/'+d.name, { limit:1000 }).then(function(fl){
          var files=fl.data?fl.data:[]; return files.map(function(f){ return examId+'/'+d.name+'/'+f.name; });
        });
      });
      return Promise.all(lists).then(function(arrs){
        var all=[]; arrs.forEach(function(a){ all=all.concat(a); });
        if(all.length===0){ return Promise.resolve(); }
        return SB.storage.from(BUCKET).remove(all);
      });
    }).then(function(){ return SB.from(TABLE).delete().eq('exam_id', examId); });
  }

  return {
    init: init,
    onAutoSubmit: onAutoSubmit,
    runConsent: runConsent,
    start: start,
    finish: finish,
    stop: stop,
    persist: persist,
    isActive: isActive,
    renderIntegrityLog: renderIntegrityLog,
    clearLog: clearLog
  };
})();
