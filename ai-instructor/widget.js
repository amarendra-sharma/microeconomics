// widget.js - a text-first AI Instructor panel for an existing course page. One <script type="module"> line adds it; removing that line removes it.
// It needs the page's Supabase client (global `sb`) and course state (global `State.user`, `State.currentCourseId`), and does nothing otherwise.
// It shows only for the course ids listed in CONFIG.courseIds. Which course the page is on: staff (instructor/admin/TA) use State.teachCourseId; students use State.payCourseId
// (the professor course they joined); State.currentCourseId is checked last for pages that set it. No API key is ever in the browser: the student's own Supabase session token is sent
// to the it-ai-instructor Edge Function, which holds the instructor's key. Model text is inserted with textContent only, never as HTML.
// Graded-work review: when the course owner has turned it on, a "Graded-work review" button opens a screen where the STUDENT allows or withdraws permission for the AI to read
// their own closed work (the model has no way to do this), or asks the TA or professor for a meeting instead.
import { AiInstructorBackend, BackendError } from './backend-client.js?v=20261021a';
import { mountVisual } from './graph-render.js?v=20261025d';

const CONFIG = Object.assign({
  courseIds: ['2d6832cf-28bf-4b5a-a351-56f3a1aa2252', 'c13c165d-4ae6-4359-82a8-bac7e8323be0'],      // ECON 436 (Fall 2026), Test Course 2026
  functionUrl: 'https://rtaiivegcqqmdchpguzn.supabase.co/functions/v1/it-ai-instructor',
  katexBase: new URL('./vendor/katex/', import.meta.url).href,
  checkEveryMs: 1500,
  // Talk mode (animated instructor + voice) is opt-in per course; the text chat is unaffected for every other course.
  talkCourseIds: ['c13c165d-4ae6-4359-82a8-bac7e8323be0'],      // Test Course 2026 only, for now
  talkBase: new URL('./talk/', import.meta.url).href,
}, (typeof window !== 'undefined' && window.AI_INSTRUCTOR_WIDGET) || {});

const CSS = `
.aiw-btn{position:fixed;right:16px;bottom:16px;z-index:99990;border:0;border-radius:999px;padding:12px 18px;font:600 15px/1 system-ui,sans-serif;background:#1f5fbf;color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.35);cursor:pointer}
.aiw-btn:focus-visible,.aiw-panel button:focus-visible,.aiw-panel textarea:focus-visible,.aiw-panel select:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}
.aiw-panel{position:fixed;right:16px;bottom:16px;z-index:99991;width:min(420px,calc(100vw - 32px));height:min(640px,calc(100vh - 32px));display:flex;flex-direction:column;background:#fff;color:#1b2430;border:1px solid #c9d1dc;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.4);font:15px/1.45 system-ui,sans-serif}
.aiw-panel[hidden],.aiw-btn[hidden]{display:none}
@media (prefers-color-scheme:dark){.aiw-panel{background:#1b222b;color:#e6e9ee;border-color:#2e3744}.aiw-in,.aiw-sel{background:#12161c!important;color:#e6e9ee!important;border-color:#2e3744!important}.aiw-a{background:#252e3a!important}.aiw-note{color:#aab3c0!important}}
.aiw-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #c9d1dc33}
.aiw-head h2{margin:0;font:700 16px/1.2 system-ui,sans-serif;flex:1}
.aiw-head button{border:1px solid #8a94a355;background:transparent;color:inherit;border-radius:6px;padding:4px 8px;cursor:pointer;font:13px system-ui,sans-serif}
.aiw-note{font-size:12.5px;color:#4a5565;padding:6px 12px;border-bottom:1px solid #c9d1dc33}
.aiw-msgs{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.aiw-m{max-width:92%;padding:8px 11px;border-radius:10px;white-space:pre-wrap;word-wrap:break-word}
.aiw-u{align-self:flex-end;background:#1f5fbf;color:#fff}.aiw-a{align-self:flex-start;background:#eef1f5}
.aiw-err{align-self:stretch;background:#fde8e6;color:#8a1c14;font-size:14px}
.ai-visual{margin:8px 0 0;overflow:auto;background:#fff;color:#1b2430;border-radius:8px;padding:6px}.ai-visual svg{max-width:100%;height:auto}
.aiw-row{display:flex;gap:8px;padding:8px 12px;border-top:1px solid #c9d1dc33;align-items:flex-end}
.aiw-in{flex:1;resize:none;font:inherit;padding:8px;border:1px solid #c9d1dc;border-radius:8px;background:#fff;color:inherit;min-height:42px;max-height:120px}
.aiw-send{border:0;border-radius:8px;padding:10px 14px;background:#1f5fbf;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer}.aiw-send[disabled]{opacity:.5;cursor:default}
.aiw-sel{margin:6px 12px 0;padding:6px;border:1px solid #c9d1dc;border-radius:6px;font:14px system-ui,sans-serif;background:#fff;color:inherit}
.aiw-review{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.aiw-review[hidden]{display:none}.aiw-reviewing .aiw-msgs,.aiw-reviewing .aiw-row,.aiw-reviewing .aiw-sel{display:none}
.aiw-review h3{margin:0;font:700 15px/1.3 system-ui,sans-serif}.aiw-review p{margin:0}
.aiw-box{border:1px solid #c9d1dc;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px}
.aiw-state{font-weight:600}.aiw-on{color:#1a7f37}.aiw-off{color:#8a1c14}
.aiw-btn2{border:0;border-radius:8px;padding:10px 14px;background:#1f5fbf;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer;align-self:flex-start}.aiw-btn2.aiw-quiet{background:transparent;color:inherit;border:1px solid #8a94a3}.aiw-btn2[disabled]{opacity:.5;cursor:default}
.aiw-review label{font-size:13px;font-weight:600}.aiw-review input,.aiw-review textarea,.aiw-review select{font:inherit;padding:7px;border:1px solid #c9d1dc;border-radius:6px;background:#fff;color:inherit;width:100%;box-sizing:border-box}
.aiw-review ul{margin:0;padding-left:18px;font-size:13.5px}
@media (prefers-color-scheme:dark){.aiw-review input,.aiw-review textarea,.aiw-review select{background:#12161c;border-color:#2e3744}.aiw-box{border-color:#2e3744}.aiw-on{color:#56d364}.aiw-off{color:#ff7b72}}
.aiw-review button:focus-visible,.aiw-review input:focus-visible,.aiw-review textarea:focus-visible,.aiw-review select:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}
@media (prefers-reduced-motion:no-preference){.aiw-panel{transition:opacity .15s}}
`;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let katexPromise = null;
function loadKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (katexPromise) return katexPromise;
  katexPromise = new Promise((res) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CONFIG.katexBase + 'katex.min.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = CONFIG.katexBase + 'katex.min.js'; s.onload = () => res(window.katex || null); s.onerror = () => res(null); document.head.appendChild(s);
  });
  return katexPromise;
}

function init() {
  const st = () => (typeof window.State !== 'undefined' ? window.State : null);
  let picked = null;
  const activeCourse = () => {
    const s = st(); if (!s || !s.user) return null;
    const staff = s.role === 'instructor' || s.role === 'professor' || s.role === 'admin' || !!s.isTA;
    if (!staff && picked && CONFIG.courseIds.indexOf(picked) >= 0) return picked;   // the student chose another of their AI-enabled courses
    return (staff ? [s.teachCourseId, s.payCourseId, s.currentCourseId] : [s.payCourseId, s.currentCourseId]).find((id) => id && CONFIG.courseIds.indexOf(id) >= 0) || null;
  };
  const ready = () => !!(window.sb && activeCourse());
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

  const btn = el('button', 'aiw-btn', 'Ask AI Instructor'); btn.type = 'button'; btn.hidden = true; btn.setAttribute('aria-haspopup', 'dialog');
  const panel = el('section', 'aiw-panel'); panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'AI Instructor');
  const head = el('div', 'aiw-head'); head.appendChild(el('h2', null, 'AI Instructor'));
  const endBtn = el('button', null, 'New chat'); endBtn.type = 'button'; endBtn.title = 'End this conversation and start a fresh one';
  const closeBtn = el('button', null, 'Close'); closeBtn.type = 'button';
  const reviewBtn = el('button', null, 'Graded-work review'); reviewBtn.type = 'button'; reviewBtn.hidden = true; reviewBtn.title = 'Allow or stop the AI instructor from reviewing your own closed graded work, or ask for a meeting';
  const talkBtn = el('button', null, 'Talk'); talkBtn.type = 'button'; talkBtn.hidden = true; talkBtn.title = 'Speak with the animated AI instructor (voice)';
  head.append(talkBtn, reviewBtn, endBtn, closeBtn);
  const courseSel = el('select', 'aiw-sel'); courseSel.setAttribute('aria-label', 'Course'); courseSel.hidden = true; courseSel.title = 'Which of your courses the AI instructor is helping with';
  const note = el('div', 'aiw-note', 'AI-generated and can be wrong; check it against your textbook. Practice here is ungraded and never affects your grade.');
  const mode = el('select', 'aiw-sel'); mode.setAttribute('aria-label', 'Teaching mode'); mode.appendChild(Object.assign(el('option', null, 'Ask anything'), { value: '' }));
  const msgs = el('div', 'aiw-msgs'); msgs.setAttribute('role', 'log'); msgs.setAttribute('aria-live', 'polite'); msgs.tabIndex = 0;
  const row = el('div', 'aiw-row'); const input = el('textarea', 'aiw-in'); input.rows = 1; input.maxLength = 2000; input.setAttribute('aria-label', 'Your question'); input.placeholder = 'Type your question';
  const send = el('button', 'aiw-send', 'Send'); send.type = 'button'; row.append(input, send);
  const rv = el('div', 'aiw-review'); rv.hidden = true; rv.setAttribute('aria-label', 'Graded-work review');
  panel.append(head, courseSel, note, mode, msgs, rv, row); document.body.append(btn, panel);

  let backend = null, courseId = null, busy = false, abort = null, katexReady = false;
  const say = (cls, text) => { const m = el('div', 'aiw-m ' + cls, text); msgs.appendChild(m); msgs.scrollTop = msgs.scrollHeight; return m; };
  const makeBackend = () => {
    courseId = activeCourse();
    backend = new AiInstructorBackend({
      url: CONFIG.functionUrl, courseId,
      getToken: async () => { const r = await window.sb.auth.getSession(); const t = r && r.data && r.data.session && r.data.session.access_token; if (!t) throw new BackendError({ error: 'unauthenticated', message: 'Please sign in again.', retryable: false }); return t; },
      context: () => ({}),
      onSession: (j) => {
        const days = j.retention_days;
        note.textContent = 'AI-generated and can be wrong; check it against your textbook. Practice here is ungraded and never affects your grade. ' + (days > 0 ? 'Conversations are kept ' + days + ' days for your instructor to review.' : 'Your conversation is deleted when you end the session.');
        while (mode.options.length > 1) mode.remove(1);
        (j.teaching_modes || []).filter((m) => m.enabled).forEach((m) => mode.appendChild(Object.assign(el('option', null, m.label), { value: m.id })));
      },
      onVisual: (spec) => { const host = current, tk = talk, base = tk && tk.pending ? tk.pending() : undefined; if (host || tk) loadKatex().then((k) => { katexReady = true; if (tk && tk.addVisual) tk.addVisual(spec, k, base); if (host) mountVisual(spec, host, k); }); },   // in Talk mode the drawing also goes to the whiteboard, which reveals it as the instructor speaks
    });
  };
  let current = null;   // the assistant bubble currently receiving text (visuals attach under it)

  async function ask() {
    const text = input.value.trim(); if (!text || busy) return;
    if (!ready()) { say('aiw-err', 'Please sign in to the course first.'); return; }
    if (!backend || courseId !== activeCourse()) makeBackend();
    input.value = ''; busy = true; send.disabled = true; abort = new AbortController();
    say('aiw-u', text.indexOf('[CLASS-SECTION]') === 0 ? 'Live class: next section' : text); const bubble = say('aiw-a', ''); current = bubble;
    const stop = el('button', null, 'Stop'); stop.type = 'button'; stop.style.cssText = 'margin-left:8px;font-size:12px'; head.insertBefore(stop, endBtn); stop.onclick = () => abort.abort();
    try {
      for await (const chunk of backend.respond({ text, inputMode: 'text', mode: mode.value || undefined, signal: abort.signal })) { bubble.insertBefore(document.createTextNode(chunk), bubble.querySelector('.ai-visual')); msgs.scrollTop = msgs.scrollHeight; }
      if (!bubble.textContent.trim() && !bubble.querySelector('.ai-visual')) bubble.remove();
    } catch (e) {
      if (!bubble.textContent.trim()) bubble.remove();
      say('aiw-err', e instanceof BackendError ? e.message : 'Could not reach the instructor service. Please try again.');
    } finally { stop.remove(); busy = false; send.disabled = false; current = null; input.focus(); }
  }
  // ---- Talk mode (animated instructor + voice), loaded only when the student presses Talk --------------------------------------------------------
  let talk = null;
  const talkAllowed = () => !!(courseId || activeCourse()) && CONFIG.talkCourseIds.indexOf(activeCourse()) >= 0 && !!(window.speechSynthesis || (navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
  talkBtn.addEventListener('click', async () => {
    if (talk || !ready()) return;
    ensureBackend(); talkBtn.disabled = true;
    let bubble = null;
    const hooks = {
      studentSaid: (text) => { say('aiw-u', String(text).indexOf('[CLASS-SECTION]') === 0 ? 'Live class: next section' : text); bubble = say('aiw-a', ''); current = bubble; },
      assistantDelta: (d) => { if (bubble) { bubble.insertBefore(document.createTextNode(d), bubble.querySelector('.ai-visual')); msgs.scrollTop = msgs.scrollHeight; } },
      turnDone: () => { if (bubble && !bubble.textContent.trim() && !bubble.querySelector('.ai-visual')) bubble.remove(); bubble = null; current = null; },
    };
    try {
      const m = await import('./talk/talk.js?v=20261025d');
      let beats = 0, keep = null;
      talk = m.openTalk({ backend, getMode: () => mode.value || undefined, baseUrl: CONFIG.talkBase, hooks, onClose: () => { talk = null; current = null; if (keep) clearInterval(keep); talkBtn.focus(); } });
      if (!clsBox.hidden) { joined = true; lastStep = null; setTimeout(pollClass, 1500); }   // opening Talk during a live class means attending it by voice
      backend.warm();                                                       // pre-load the course prompt now, so the first question is answered quickly
      keep = setInterval(() => { if (document.visibilityState === 'visible' && ++beats <= 8) backend.warm(); }, 240000);   // the model's short-term memory lasts 5 minutes; refresh it while Talk is open
    } catch (e) { say('aiw-err', 'Talk mode could not start on this device. You can keep using the text chat.'); }
    finally { talkBtn.disabled = false; }
  });
  // ---- graded-work review screen -------------------------------------------------------------------------------------------------------------------
  let reviewStatus = null, reviewCourse = null;
  const ensureBackend = () => { if (!backend || courseId !== activeCourse()) makeBackend(); return backend; };
  const KIND = { exam: 'exam', quiz: 'quiz', arena: 'arena', assignment: 'assignment' };
  async function loadReview() {
    if (!ready()) return null;
    try {
      const b = ensureBackend(); const cid = courseId;
      const s = await b.call({ action: 'review_status', course_id: cid });
      reviewStatus = s; reviewCourse = cid; reviewBtn.hidden = !(s && s.review_enabled);
      return s;
    } catch (_) { reviewBtn.hidden = true; return null; }
  }
  function renderReview(msg) {
    const s = reviewStatus; rv.textContent = '';
    if (!s) { rv.append(el('p', null, 'Could not load this screen. Please try again.')); return; }
    rv.append(el('h3', null, 'Review my graded work with the AI instructor'));
    const box = el('div', 'aiw-box'); box.append(el('p', null, s.consent_text));
    const state = el('p', 'aiw-state ' + (s.granted ? 'aiw-on' : 'aiw-off'), s.granted ? 'You have allowed this. You can turn it off at any time.' : 'Not allowed. The AI instructor cannot see your graded work.');
    state.setAttribute('role', 'status'); box.append(state);
    const toggle = el('button', 'aiw-btn2' + (s.granted ? ' aiw-quiet' : ''), s.granted ? 'Turn off' : 'Allow'); toggle.type = 'button';
    toggle.onclick = async () => {
      toggle.disabled = true;
      try { const r = await ensureBackend().call({ action: 'review_consent', course_id: reviewCourse, granted: !s.granted }); await loadReview(); renderReview(r.granted ? 'Allowed. You can now ask the AI instructor to go over an exam, quiz, arena or assignment once its deadline has passed.' : 'Turned off. The AI instructor can no longer see your graded work.'); }
      catch (e) { toggle.disabled = false; renderReview(e instanceof BackendError ? e.message : 'Could not save that. Please try again.'); }
    };
    box.append(toggle); rv.append(box);
    if (msg) { const m = el('p', 'aiw-state', msg); m.setAttribute('role', 'status'); rv.append(m); }
    if (s.granted && s.recent_access && s.recent_access.length) {
      const b2 = el('div', 'aiw-box'); b2.append(el('p', null, 'Recently opened by the AI instructor (newest first):'));
      const ul = el('ul'); s.recent_access.forEach((r) => ul.append(el('li', null, (KIND[r.kind] || 'item') + ' \u2013 ' + new Date(r.at).toLocaleString()))); b2.append(ul); rv.append(b2);
    }
    // the fallback: a person instead of the AI
    const mt = el('div', 'aiw-box'); mt.append(el('h3', null, 'Prefer to talk to a person?'));
    mt.append(el('p', null, 'Ask the TA or the professor for a meeting to go over your work. This works whether or not you allow the AI instructor.'));
    const who = el('select'); who.id = 'aiw-who'; [['ta', 'The TA'], ['professor', 'The professor']].forEach(([v, l]) => who.append(Object.assign(el('option', null, l), { value: v })));
    const whoL = el('label', null, 'Who would you like to meet?'); whoL.htmlFor = 'aiw-who';
    const topic = el('input'); topic.id = 'aiw-topic'; topic.maxLength = 200; topic.placeholder = 'For example: Exam 1, question 4'; const topicL = el('label', null, 'What would you like to go over?'); topicL.htmlFor = 'aiw-topic';
    const note2 = el('textarea'); note2.id = 'aiw-note2'; note2.rows = 2; note2.maxLength = 500; note2.placeholder = 'Optional: days or times that suit you'; const noteL = el('label', null, 'Your availability (optional)'); noteL.htmlFor = 'aiw-note2';
    const go = el('button', 'aiw-btn2', 'Request a meeting'); go.type = 'button';
    const out = el('p', 'aiw-state'); out.setAttribute('role', 'status');
    go.onclick = async () => {
      if (!topic.value.trim()) { out.textContent = 'Please say what you would like to go over.'; out.className = 'aiw-state aiw-off'; topic.focus(); return; }
      go.disabled = true;
      try { await ensureBackend().call({ action: 'request_meeting', course_id: reviewCourse, with: who.value, topic: topic.value.trim(), note: note2.value.trim() || undefined }); await loadReview(); renderReview('Your request was sent to ' + (who.value === 'ta' ? 'the TA' : 'the professor') + '. They will contact you.'); }
      catch (e) { go.disabled = false; out.textContent = e instanceof BackendError ? e.message : 'Could not send that. Please try again.'; out.className = 'aiw-state aiw-off'; }
    };
    mt.append(whoL, who, topicL, topic, noteL, note2, go, out);
    const open = (s.my_requests || []).filter((r) => r.status === 'open');
    if (open.length) { mt.append(el('p', null, 'Your open requests:')); const ul = el('ul'); open.forEach((r) => ul.append(el('li', null, (r.with === 'ta' ? 'TA' : 'Professor') + ': ' + r.topic))); mt.append(ul); }
    rv.append(mt);
    const back = el('button', 'aiw-btn2 aiw-quiet', 'Back to chat'); back.type = 'button'; back.onclick = closeReview; rv.append(back);
    if (msg) rv.scrollTop = 0;
  }
  async function openReview() {
    panel.classList.add('aiw-reviewing'); rv.hidden = false; rv.textContent = ''; rv.append(el('p', null, 'Loading\u2026'));
    await loadReview(); renderReview(); const h = rv.querySelector('h3'); if (h) { h.tabIndex = -1; h.focus(); }
  }
  function closeReview() { panel.classList.remove('aiw-reviewing'); rv.hidden = true; input.focus(); }

  // A student enrolled in more than one AI-enabled course picks which one Asha is working in (the portal itself follows one course).
  let coursesLoaded = false;
  async function loadCourseChoices() {
    if (coursesLoaded) return; const s = st();
    if (!s || !s.user || !window.sb || s.role === 'instructor' || s.role === 'professor' || s.role === 'admin' || s.isTA) return;
    coursesLoaded = true;
    try {
      const en = await window.sb.from(CONFIG.enrollTable || 'im_enrollment').select('course_id').eq('student_id', s.user.id).eq('status', 'active');
      const ids = ((en && en.data) || []).map((r) => r.course_id).filter((id) => CONFIG.courseIds.indexOf(id) >= 0);
      if (ids.length < 2) return;
      const cr = await window.sb.from(CONFIG.courseTable || 'im_course').select('id,title').in('id', ids);
      const title = {}; ((cr && cr.data) || []).forEach((c) => { title[c.id] = c.title; });
      courseSel.textContent = '';
      ids.forEach((id) => courseSel.appendChild(Object.assign(el('option', null, title[id] || 'Course'), { value: id })));
      courseSel.value = activeCourse() && ids.indexOf(activeCourse()) >= 0 ? activeCourse() : ids[0];
      courseSel.hidden = false;
    } catch (_) { coursesLoaded = false; }
  }
  courseSel.addEventListener('change', () => {
    if (abort && busy) abort.abort();
    picked = courseSel.value; backend = null; msgs.textContent = ''; reviewStatus = null; reviewBtn.hidden = true; closeReview(); if (talk) talk.close();
    ensureBackend(); loadReview();
  });
  reviewBtn.onclick = openReview;
  function close() { closeReview(); panel.hidden = true; btn.hidden = !ready(); btn.focus(); }
  btn.onclick = () => { panel.hidden = false; btn.hidden = true; input.focus(); loadCourseChoices().then(loadReview); };
  closeBtn.onclick = close;
  send.onclick = ask;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  endBtn.onclick = async () => { if (abort && busy) abort.abort(); if (backend) { try { await backend.endSession(); } catch (_) { /* ignore */ } } backend = null; msgs.textContent = ''; };

  // ---- live class banner: shows while the professor's class is running; joining records attendance and has the instructor teach each section ----------
  const clsBox = el('div', 'aiw-class'); clsBox.hidden = true; clsBox.style.cssText = 'padding:8px 10px;margin:6px 0;border:1px solid rgba(24,121,78,.5);border-radius:8px;font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
  const clsText = el('span'); clsText.style.flex = '1'; const clsBtn = el('button', null, 'Join class'); clsBtn.type = 'button'; clsBox.append(clsText, clsBtn); panel.insertBefore(clsBox, msgs);
  let joined = false, lastStep = null, lastClass = null, clsBusy = false;
  const secTitle = (c) => (c && typeof c === 'object' ? c.title : c) || '';
  async function pollClass() {
    if (clsBusy || !ready() || document.visibilityState !== 'visible') return; clsBusy = true;
    try {
      const b = ensureBackend(); const r = await b.call({ action: 'class_status', course_id: courseId, join: joined });
      if (!r || !r.live || !r.student) { clsBox.hidden = true; joined = false; lastStep = null; lastClass = null; btn.textContent = 'Ask AI Instructor'; return; }
      if (lastClass !== r.title) { joined = false; lastStep = null; lastClass = r.title; }
      clsBox.hidden = false; btn.textContent = 'Live class now: join';
      clsText.textContent = 'Live class: ' + r.title + ' - section ' + (Number(r.step) + 1) + ' of ' + r.sections + (secTitle(r.current) ? ': ' + secTitle(r.current) : '') + (joined ? (r.present ? ' (you are marked present)' : ' (attendance is being recorded)') : '');
      clsBtn.hidden = joined;
      if (joined && lastStep !== r.step && !busy && !current) {   // wait until the instructor has finished speaking or writing the previous part
        const first = lastStep === null; lastStep = r.step;
        const cue = '[CLASS-SECTION] ' + (first ? 'The student has joined the class. Teach the current section: ' : 'The class has moved on to the next section: ') + secTitle(r.current) + '.';
        if (talk) { talk.getVoice().then((v) => v.submitText(cue)).catch(() => { lastStep = null; }); } else { input.value = cue; ask(); }
      }
    } catch (_) { /* class state is optional */ } finally { clsBusy = false; }
  }
  clsBtn.onclick = () => { joined = true; lastStep = null; if (panel.hidden) { panel.hidden = false; btn.hidden = true; } pollClass(); };
  setInterval(pollClass, 20000); setTimeout(pollClass, 4000);
  setInterval(() => {   // follow the page: show only inside an eligible course while signed in; tidy up on sign-out or course change
    const ok = ready();
    if (!ok) { if (!panel.hidden || backend) { panel.hidden = true; if (abort && busy) abort.abort(); backend = null; msgs.textContent = ''; closeReview(); } reviewStatus = null; reviewBtn.hidden = true; talkBtn.hidden = true; if (talk) talk.close(); btn.hidden = true; return; }
    if (backend && courseId !== activeCourse()) { backend = null; msgs.textContent = ''; reviewStatus = null; reviewBtn.hidden = true; closeReview(); if (talk) talk.close(); }
    talkBtn.hidden = !talkAllowed();
    btn.hidden = !panel.hidden;
  }, CONFIG.checkEveryMs);
  void katexReady;
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
