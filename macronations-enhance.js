/* ============================================================================
 * macronations-enhance.js  —  shared accessibility + read-aloud + sound layer
 * for every MacroNations course (current and future).
 *
 * ROLLOUT: host this file once at a stable URL and add ONE line before </body>
 * on each course page:
 *     <script src="https://macronations.com/shared/macronations-enhance.js" defer></script>
 * Updating this single file updates every course.
 *
 * Self-contained (no dependencies), idempotent, and safe to load twice.
 * If a page already ships the inline accessibility menu (International Trade),
 * this script augments it with Read-aloud + Sound instead of duplicating it.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mnEnhance) { return; }
  window.__mnEnhance = true;

  var LS = 'mn_enhance_prefs';
  var prefs = { z: 1, hc: 0, cb: 0, sound: 0 };
  try { var raw = localStorage.getItem(LS); if (raw) { var o = JSON.parse(raw) || {}; for (var k in o) { prefs[k] = o[k]; } } } catch (e) {}
  // migrate legacy per-course keys the first time
  try {
    if (!localStorage.getItem(LS)) {
      var leg = JSON.parse(localStorage.getItem('it_a11y') || 'null');
      if (leg) { prefs.z = leg.z || 1; prefs.hc = leg.hc || 0; prefs.cb = leg.cb || 0; }
    }
  } catch (e) {}
  function save() { try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch (e) {} }
  function ready(fn) { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn); } else { fn(); } }

  var hasNative = false;   // page already has the inline International-Trade a11y menu

  /* ---------------- CSS ---------------- */
  function injectCSS() {
    if (document.getElementById('mn-enhance-css')) { return; }
    var css = ''
      + 'a.mn-skip{position:absolute;left:8px;top:-60px;background:var(--violet,#7c6df2);color:#fff;padding:10px 16px;border-radius:8px;z-index:100000;transition:top .15s;text-decoration:none;font-weight:600;}'
      + 'a.mn-skip:focus{top:8px;outline:3px solid #fff;}'
      + ':focus-visible{outline:3px solid var(--amber,#e6a94b);outline-offset:2px;border-radius:4px;}'
      + 'button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[tabindex]:focus-visible,.mn-seg:focus-visible{outline:3px solid var(--amber,#e6a94b);outline-offset:2px;}'
      // high contrast: set every common accent-var name so it recolors across courses
      + 'html.mn-hc{--bg:#000;--bg-deep:#000;--panel:#0b0b0b;--panel2:#000;--surface:#0b0b0b;--surface-strong:#161616;'
      + '--ink:#fff;--text:#fff;--bright:#fff;--muted:#ececec;--faint:#d2d2d2;--subtle:#d2d2d2;--text-muted:#ececec;--text-subtle:#d2d2d2;'
      + '--line:#fff;--line2:#fff;--border:#fff;--border-strong:#fff;--accent:#ffd23f;--primary:#cdbcff;'
      + '--violet:#cdbcff;--violet2:#cdbcff;--violet-deep:#b9a2ff;--green:#5cf5ab;--amber:#ffd23f;--rose:#ff9aa6;--blue:#8ec6ff;}'
      + 'html.mn-hc body{background:#000 !important;color:#fff;}'
      // colorblind-safe (Okabe-Ito)
      + 'html.mn-cb{--violet:#0072B2;--violet2:#3a93cc;--violet-deep:#005b8f;--blue:#56B4E9;--green:#009E73;--amber:#E69F00;--rose:#D55E00;}'
      // text zoom
      + 'html.mn-z2 body{zoom:1.15;} html.mn-z3 body{zoom:1.3;}'
      // widget
      + '#mnBar{position:fixed;top:10px;right:12px;z-index:99998;font-family:inherit;}'
      + '.mn-btn{display:inline-flex;align-items:center;gap:6px;background:var(--panel,#161b26);border:1px solid var(--line2,rgba(255,255,255,.2));color:var(--bright,#fff);border-radius:8px;padding:7px 11px;font-size:12.5px;cursor:pointer;font-family:inherit;}'
      + '.mn-panel{position:absolute;right:0;top:100%;margin-top:8px;background:var(--panel2,#0f141d);border:1px solid var(--line2,rgba(255,255,255,.25));border-radius:12px;padding:14px;min-width:250px;max-width:290px;z-index:99999;box-shadow:0 12px 40px rgba(0,0,0,.55);}'
      + '.mn-panel h4{font-size:13px;margin:0 0 8px;color:var(--bright,#fff);}'
      + '.mn-panel .mn-sec{margin-bottom:12px;}'
      + '.mn-row{display:flex;gap:6px;flex-wrap:wrap;}'
      + '.mn-seg{flex:1;min-width:60px;text-align:center;padding:6px 8px;border:1px solid var(--line2,rgba(255,255,255,.25));border-radius:8px;cursor:pointer;font-size:12px;color:var(--ink,var(--text,#ccc));background:transparent;font-family:inherit;}'
      + '.mn-seg[aria-pressed="true"]{background:var(--violet,#7c6df2);color:#fff;border-color:var(--violet,#7c6df2);}'
      + '.mn-panel.mn-hidden,.mn-hidden{display:none;}'
      + '.mn-note{font-size:11px;color:var(--muted,#8b96b3);line-height:1.5;margin-top:4px;}'
      + '@media (prefers-reduced-motion: reduce){*{animation:none !important;transition:none !important;scroll-behavior:auto !important;}}';
    var st = document.createElement('style'); st.id = 'mn-enhance-css'; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function applyClasses() {
    var d = document.documentElement;
    d.classList.remove('mn-z1', 'mn-z2', 'mn-z3');
    if (prefs.z > 1) { d.classList.add('mn-z' + prefs.z); }
    d.classList.toggle('mn-hc', !!prefs.hc);
    d.classList.toggle('mn-cb', !!prefs.cb);
  }

  /* ---------------- landmark + skip link ---------------- */
  function ensureLandmark() {
    try {
      var m = document.querySelector('main')
        || document.querySelector('section,.wrap,.container,.page,.reader,.book,.chapter,.game,.arena,.app,.stage,.main')
        || document.body.firstElementChild;
      if (m) { if (!m.id) { m.id = 'mnMain'; } if (!m.getAttribute('role')) { m.setAttribute('role', 'main'); } if (!m.hasAttribute('tabindex')) { m.setAttribute('tabindex', '-1'); } }
      if (!document.querySelector('a.mn-skip') && !document.querySelector('a.skip-link')) {
        var a = document.createElement('a'); a.className = 'mn-skip'; a.href = '#' + (m ? m.id : 'mnMain'); a.textContent = 'Skip to main content';
        document.body.insertBefore(a, document.body.firstChild);
      }
    } catch (e) {}
  }

  /* ---------------- speech (Read aloud) ---------------- */
  var speaking = false;
  function stopSpeech() {
    try { window.speechSynthesis.cancel(); } catch (e) {}
    speaking = false; refreshReadBtn();
  }
  function chunk(text) {
    var parts = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*/g) || [text];
    var out = [], buf = '';
    for (var i = 0; i < parts.length; i++) {
      if ((buf + parts[i]).length > 220) { if (buf) { out.push(buf.trim()); } buf = parts[i]; }
      else { buf += ' ' + parts[i]; }
    }
    if (buf.trim()) { out.push(buf.trim()); }
    return out;
  }
  function readAloud() {
    if (!('speechSynthesis' in window)) { alert('Your browser does not support text-to-speech.'); return; }
    if (speaking) { stopSpeech(); return; }
    var sel = (window.getSelection && String(window.getSelection())) || '';
    var text = sel.trim();
    if (!text) {
      var main = document.getElementById('mainContent') || document.getElementById('mnMain')
        || document.querySelector('[role="main"], main') || document.body;
      // prefer the visible view in single-page apps
      var visibleSection = null;
      var secs = main.querySelectorAll ? main.querySelectorAll('section') : [];
      for (var i = 0; i < secs.length; i++) { if (secs[i].offsetParent !== null && !secs[i].classList.contains('hidden')) { visibleSection = secs[i]; break; } }
      text = ((visibleSection || main).innerText || (visibleSection || main).textContent || '').trim();
    }
    if (!text) { return; }
    var pieces = chunk(text);
    speaking = true; refreshReadBtn();
    var idx = 0;
    function next() {
      if (!speaking || idx >= pieces.length) { speaking = false; refreshReadBtn(); return; }
      var u = new SpeechSynthesisUtterance(pieces[idx++]);
      u.rate = 1.0; u.onend = next; u.onerror = function () { speaking = false; refreshReadBtn(); };
      window.speechSynthesis.speak(u);
    }
    next();
  }
  function refreshReadBtn() {
    var b = document.getElementById('mnReadBtn');
    if (b) { b.textContent = speaking ? '■ Stop reading' : '▶ Read aloud'; b.setAttribute('aria-pressed', String(speaking)); }
  }
  window.addEventListener('beforeunload', stopSpeech);

  /* ---------------- sound cues (optional, off by default) ---------------- */
  var actx = null, lastTick = 0;
  function ac() {
    if (!prefs.sound) { return null; }
    try { if (!actx) { actx = new (window.AudioContext || window.webkitAudioContext)(); } if (actx.state === 'suspended') { actx.resume(); } } catch (e) { return null; }
    return actx;
  }
  function tone(freq, dur, vol, type) {
    var c = ac(); if (!c) { return; }
    try {
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.value = 0.0001; o.connect(g); g.connect(c.destination);
      var t = c.currentTime;
      g.gain.exponentialRampToValueAtTime(vol || 0.05, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
      o.start(t); o.stop(t + (dur || 0.08) + 0.02);
    } catch (e) {}
  }
  window.mnSound = {
    tick: function () { var now = Date.now(); if (now - lastTick < 40) { return; } lastTick = now; tone(660, 0.03, 0.03, 'square'); },
    win:  function () { tone(523, 0.12, 0.06); setTimeout(function () { tone(784, 0.16, 0.06); }, 110); },
    lose: function () { tone(300, 0.18, 0.05, 'sawtooth'); },
    click: function () { tone(440, 0.04, 0.04, 'triangle'); }
  };
  function initSound() {
    // slider ticks
    document.addEventListener('input', function (e) {
      if (!prefs.sound) { return; }
      var t = e.target;
      if (t && t.tagName === 'INPUT' && (t.type === 'range')) { window.mnSound.tick(); }
    }, true);
    // win/lose chimes on common result markers (opt-in classes / data attribute)
    try {
      var mo = new MutationObserver(function (muts) {
        if (!prefs.sound) { return; }
        muts.forEach(function (mm) {
          Array.prototype.forEach.call(mm.addedNodes || [], function (n) {
            if (n.nodeType !== 1) { return; }
            var cls = (n.className && n.className.toString ? n.className.toString() : '') + ' ' + (n.getAttribute ? (n.getAttribute('data-mn-sound') || '') : '');
            if (/\b(mn-win|result-win|you-win|win|correct|tag-ok|success)\b/i.test(cls)) { window.mnSound.win(); }
            else if (/\b(mn-lose|result-lose|you-lose|lose|incorrect|tag-no|fail)\b/i.test(cls)) { window.mnSound.lose(); }
          });
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  /* ---------------- panel ---------------- */
  function seg(attr, val, label) { return '<button class="mn-seg" data-' + attr + '="' + val + '">' + label + '</button>'; }
  function setPressed(rowId, attr, val) {
    var r = document.getElementById(rowId); if (!r) { return; }
    Array.prototype.forEach.call(r.querySelectorAll('.mn-seg'), function (b) { b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-' + attr)) === Number(val))); });
  }
  function applyAll() {
    applyClasses(); save();
    setPressed('mnZoom', 'z', prefs.z || 1); setPressed('mnHc', 'hc', prefs.hc || 0);
    setPressed('mnCb', 'cb', prefs.cb || 0); setPressed('mnSnd', 'sound', prefs.sound || 0);
  }

  function readAloudSectionHTML() {
    return '<div class="mn-sec"><h4>Read aloud</h4><div class="mn-row">'
      + '<button class="mn-seg" id="mnReadBtn" style="flex:1;" aria-pressed="false">▶ Read aloud</button></div>'
      + '<div class="mn-note">Reads your selected text, or the current page/section.</div></div>';
  }
  function soundSectionHTML() {
    return '<div class="mn-sec"><h4>Sound effects</h4><div class="mn-row" id="mnSnd">'
      + seg('sound', 0, 'Off') + seg('sound', 1, 'On') + '</div>'
      + '<div class="mn-note">Optional audio cues in the games (slider ticks, win chimes).</div></div>';
  }
  function wireExtras(root) {
    var rb = root.querySelector('#mnReadBtn'); if (rb) { rb.addEventListener('click', readAloud); }
    var snd = root.querySelector('#mnSnd');
    if (snd) { snd.addEventListener('click', function (e) { var b = e.target.closest('.mn-seg'); if (!b) { return; } prefs.sound = Number(b.getAttribute('data-sound')); if (prefs.sound) { ac(); } applyAll(); }); }
    refreshReadBtn();
  }

  function buildFullPanel() {
    var bar = document.createElement('div'); bar.id = 'mnBar';
    bar.innerHTML =
      '<button class="mn-btn" id="mnBtn" aria-haspopup="true" aria-expanded="false" aria-controls="mnPanel" title="Accessibility settings">♿ <span>Accessibility</span></button>'
      + '<div class="mn-panel mn-hidden" id="mnPanel" role="dialog" aria-label="Accessibility settings">'
      + '<div class="mn-sec"><h4>Text size</h4><div class="mn-row" id="mnZoom">' + seg('z', 1, 'Normal') + seg('z', 2, 'Large') + seg('z', 3, 'Larger') + '</div></div>'
      + '<div class="mn-sec"><h4>Contrast</h4><div class="mn-row" id="mnHc">' + seg('hc', 0, 'Standard') + seg('hc', 1, 'High contrast') + '</div></div>'
      + '<div class="mn-sec"><h4>Graph &amp; accent colors</h4><div class="mn-row" id="mnCb">' + seg('cb', 0, 'Default') + seg('cb', 1, 'Colorblind-safe') + '</div></div>'
      + readAloudSectionHTML() + soundSectionHTML()
      + '<div class="mn-note">Saved to this browser. Diagrams also use text labels, so they never rely on color alone.</div></div>';
    document.body.appendChild(bar);
    var btn = document.getElementById('mnBtn'), pan = document.getElementById('mnPanel');
    btn.addEventListener('click', function () { var open = pan.classList.toggle('mn-hidden') === false; btn.setAttribute('aria-expanded', String(open)); });
    document.addEventListener('click', function (e) { if (!bar.contains(e.target) && !pan.classList.contains('mn-hidden')) { pan.classList.add('mn-hidden'); btn.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pan.classList.contains('mn-hidden')) { pan.classList.add('mn-hidden'); btn.setAttribute('aria-expanded', 'false'); } });
    document.getElementById('mnZoom').addEventListener('click', function (e) { var b = e.target.closest('.mn-seg'); if (!b) { return; } prefs.z = Number(b.getAttribute('data-z')); applyAll(); });
    document.getElementById('mnHc').addEventListener('click', function (e) { var b = e.target.closest('.mn-seg'); if (!b) { return; } prefs.hc = Number(b.getAttribute('data-hc')); applyAll(); });
    document.getElementById('mnCb').addEventListener('click', function (e) { var b = e.target.closest('.mn-seg'); if (!b) { return; } prefs.cb = Number(b.getAttribute('data-cb')); applyAll(); });
    wireExtras(pan);
    applyAll();
  }

  function augmentNativePanel() {
    // page already has the International-Trade inline menu (#a11yPanel): just add
    // Read-aloud + Sound so we don't duplicate contrast/zoom/colorblind controls.
    var pan = document.getElementById('a11yPanel'); if (!pan) { return; }
    if (!pan.querySelector('#mnReadBtn')) {
      var wrap = document.createElement('div');
      wrap.innerHTML = readAloudSectionHTML() + soundSectionHTML();
      while (wrap.firstChild) { pan.appendChild(wrap.firstChild); }
      wireExtras(pan);
      setPressed('mnSnd', 'sound', prefs.sound || 0);
    }
  }

  ready(function () {
    hasNative = !!document.getElementById('a11yPanel');   // page ships the inline IT menu
    injectCSS();
    ensureLandmark();
    initSound();
    if (hasNative) {
      // native menu owns contrast/zoom/colorblind; we only add read-aloud + sound
      augmentNativePanel();
    } else {
      applyClasses();
      buildFullPanel();
    }
  });
})();
