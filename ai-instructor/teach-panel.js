// AI Instructor setup inside the portal's Teach menu.
// Self-contained: adds one nav item to #teachGroup and renders into #viewHost.
// Uses the portal's own signed-in Supabase client (window.sb); no second sign-in,
// the API key is sent once to the instructor's own Supabase function and never kept here.
// All server text is written with textContent.
const VIEW = 'aiinstructor';
const CLAUDE = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'];
const PROVS = {
  anthropic: { label: 'Claude (Anthropic)', ph: 'sk-ant-...', note: 'Default. Conversations go to Anthropic.' },
  gemini: { label: 'Google Gemini', ph: 'AIza...', note: 'Student questions are sent to Google. Use a key from a paid/Cloud billing project: free-tier Gemini use may be used by Google to improve its products. Check Google’s current terms before enrolling students.' },
  openai: { label: 'OpenAI', ph: 'sk-...', note: 'Student questions are sent to OpenAI under your API terms.' },
  groq: { label: 'Groq', ph: 'gsk_...', note: 'Student questions are sent to Groq under your API terms.' },
  openrouter: { label: 'OpenRouter', ph: 'sk-or-...', note: 'Student questions pass through OpenRouter to whichever model you name; check that model’s data policy.' },
  custom: { label: 'Other OpenAI-compatible service', ph: 'API key', note: 'Only addresses your platform administrator has approved will work.' },
};

function cfg() { return window.AI_INSTRUCTOR_CONFIG || null; }
async function ensureConfig() {
  if (cfg()) return cfg();
  await new Promise((res) => {
    const s = document.createElement('script');
    s.src = new URL('./config.js', import.meta.url).href;
    s.onload = s.onerror = res;
    document.head.appendChild(s);
  });
  return cfg();
}
async function call(body) {
  const c = await ensureConfig();
  if (!c || !c.functionUrl) throw new Error('AI instructor is not configured on this site.');
  const s = (await window.sb.auth.getSession()).data.session;
  if (!s) throw new Error('Please sign in again.');
  const r = await fetch(c.functionUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + s.access_token },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || 'Request failed (' + r.status + ')');
  return j;
}

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k of Object.keys(props)) {
    if (k === 'class') e.className = props[k];
    else if (k === 'text') e.textContent = props[k];
    else e[k] = props[k];
  }
  for (const k of kids) if (k) e.appendChild(k);
  return e;
}
function field(label, input) {
  return el('div', { style: 'margin:10px 0' }, el('label', { text: label, style: 'display:block;font-weight:600;margin-bottom:4px' }), input);
}
function check(label) {
  const cb = el('input', { type: 'checkbox' });
  cb.style.cssText = 'width:auto;margin-right:8px';
  const wrap = el('label', { style: 'display:block;margin:10px 0' }, cb, document.createTextNode(label));
  return { cb, wrap };
}
function msg() { const m = el('div', { style: 'min-height:1.4em;margin-top:8px' }); m.setAttribute('role', 'status'); m.say = (t, cls) => { m.textContent = t; m.style.color = cls === 'bad' ? 'var(--danger,#b3261e)' : cls === 'ok' ? 'var(--success,#18794e)' : ''; }; return m; }
function btn(text, secondary) { const b = el('button', { type: 'button', text }); b.className = secondary ? 'btn secondary' : 'btn'; b.style.marginRight = '8px'; b.style.marginTop = '8px'; return b; }

let token = 0; // ignore stale renders after navigating away / switching course

async function render(host) {
  const my = ++token;
  host.textContent = '';
  const st = window.State || {};
  if (st.isTA && st.role !== 'instructor' && st.role !== 'professor' && st.role !== 'admin') {
    host.appendChild(el('div', { class: 'card empty', text: 'Only the course instructor can change AI Instructor settings.' }));
    return;
  }

  // ---- Key card ----
  const keyCard = el('div', { class: 'card' });
  keyCard.appendChild(el('h3', { text: 'AI provider and key' }));
  keyCard.appendChild(el('div', { text: 'Your key is sent once over HTTPS to your own Supabase function, stored encrypted there, and never shown again. It is not kept in this browser.', style: 'font-size:12.5px;opacity:.8' }));
  const status = msg(); keyCard.appendChild(status);
  const prov = el('select');
  Object.keys(PROVS).forEach((k) => prov.appendChild(el('option', { value: k, text: PROVS[k].label })));
  const pnote = el('div', { style: 'font-size:12.5px;opacity:.85;margin:6px 0' });
  const key = el('input', { type: 'password', autocomplete: 'off', spellcheck: false });
  const model = el('select'); CLAUDE.forEach((m) => model.appendChild(el('option', { value: m, text: m })));
  const mtext = el('input', { placeholder: 'model name, e.g. gemini-2.5-flash', spellcheck: false });
  const pin = el('input', { type: 'number', min: 0, step: 0.01 });
  const pout = el('input', { type: 'number', min: 0, step: 0.01 });
  const burl = el('input', { placeholder: 'https://...', spellcheck: false });
  const modelF = field('Model', model), mtextF = field('Model', mtext);
  const priceBox = el('div', null,
    field('Price per million INPUT tokens (USD, from your provider’s pricing page)', pin),
    field('Price per million OUTPUT tokens (USD)', pout),
    el('div', { text: 'Used only to estimate spending against the monthly cap. Left blank, a high placeholder price is used so the cap stops early.', style: 'font-size:12.5px;opacity:.8' }));
  const urlF = field('Service address (must be on the platform’s approved list)', burl);
  const provUI = () => {
    const p = prov.value, a = p === 'anthropic';
    key.placeholder = PROVS[p].ph;
    pnote.textContent = PROVS[p].note + (a ? '' : ' This tutor was tuned and tested with Claude; other models can behave differently, so try it yourself first. A different provider replaces the key on file.');
    modelF.hidden = !a; mtextF.hidden = a; priceBox.hidden = a; urlF.hidden = p !== 'custom';
  };
  prov.onchange = provUI;
  const keyMsg = msg();
  const save = btn('Check and save key'), del = btn('Remove key', true);
  keyCard.append(field('Provider', prov), pnote, field('API key', key), modelF, mtextF, priceBox, urlF, save, del, keyMsg);
  provUI();
  async function refresh() {
    try {
      const j = await call({ action: 'key_status' });
      if (my !== token) return;
      status.say(j.has_key ? 'Key on file ending in ' + j.last4 + ' (' + ((PROVS[j.provider] || { label: j.provider }).label) + ', model ' + j.model + ').' : 'No key saved yet.', j.has_key ? 'ok' : '');
      if (j.provider && PROVS[j.provider]) { prov.value = j.provider; provUI(); }
      if (j.model) { if (j.provider === 'anthropic') model.value = j.model; else mtext.value = j.model; }
    } catch (e) { status.say(e.message, 'bad'); }
  }
  save.onclick = async () => {
    const p = prov.value, a = p === 'anthropic';
    keyMsg.say('Checking the key with ' + PROVS[p].label + '...');
    const body = { action: 'set_key', api_key: key.value.trim(), provider: p, model: a ? model.value : mtext.value.trim(), validate: true };
    if (!a) { if (pin.value !== '') body.price_in = +pin.value; if (pout.value !== '') body.price_out = +pout.value; if (p === 'custom') body.base_url = burl.value.trim(); }
    try { await call(body); keyMsg.say('Key saved.', 'ok'); refresh(); } catch (e) { keyMsg.say(e.message, 'bad'); }
    key.value = '';
  };
  del.onclick = async () => { try { await call({ action: 'delete_key' }); keyMsg.say('Key removed.', 'ok'); refresh(); } catch (e) { keyMsg.say(e.message, 'bad'); } };
  host.appendChild(keyCard);

  // ---- Course settings card ----
  const cid = st.teachCourseId;
  const cs = el('div', { class: 'card' });
  cs.appendChild(el('h3', { text: 'Settings for the selected course' }));
  host.appendChild(cs);
  if (!cid) { cs.appendChild(el('div', { text: 'Create or select a course first (Courses tab).' })); refresh(); return; }
  const smsg = msg();
  let s;
  try { const j = await call({ action: 'get_settings', course_id: cid }); s = j.settings || j; }
  catch (e) { cs.appendChild(smsg); smsg.say(e.message, 'bad'); refresh(); return; }
  if (my !== token) return;
  const en = check('AI instructor enabled for this course'); en.cb.checked = !!s.enabled;
  const ret = el('input', { type: 'number', min: 0, max: 365, value: s.retention_days });
  const tok = el('input', { type: 'number', min: 1000, max: 1000000, value: s.student_daily_tokens });
  const usd = el('input', { type: 'number', min: 0, step: 0.5, value: s.course_monthly_usd });
  cs.append(en.wrap, field('Keep conversations for (days; 0 = delete when the session ends)', ret),
    field('Daily token limit per student', tok), field('Monthly spending cap for this course (USD)', usd));
  const hasReview = 'review_enabled' in s;
  let rven, rvsol;
  if (hasReview) {
    cs.appendChild(el('h4', { text: 'Reviewing graded work with the AI' }));
    cs.appendChild(el('div', { style: 'font-size:12.5px;opacity:.85', text: 'Off by default. When on, a student who agrees (a button in the chat window, never the AI) lets the AI instructor open their own exams, chapter quizzes, arenas and assignments, but only after the item has closed for the whole class, including any extensions. Items with no deadline set are never opened. Students who do not agree can ask the TA or you for a meeting.' }));
    rven = check('Let students review their own closed graded work with the AI instructor'); rven.cb.checked = !!s.review_enabled;
    rvsol = check('Let the AI also see the correct answers and explanations (only when the AI policy is "full")'); rvsol.cb.checked = s.review_show_solutions !== false;
    cs.append(rven.wrap, rvsol.wrap);
  }
  const hasScope = 'scope_mode' in s;
  let scopeCb, textCb; const kindCbs = {};
  if (hasScope) {
    cs.appendChild(el('h4', { text: 'What students may use the AI instructor for' }));
    cs.appendChild(el('div', { style: 'font-size:12.5px;opacity:.85', text: 'Use these to keep the AI instructor on your course and keep costs down. Changes apply to the next question a student asks.' }));
    scopeCb = check('Only help with this course: politely decline anything outside the course subject'); scopeCb.cb.checked = s.scope_mode !== 'open';
    textCb = check('Explain textbook material and help with practice problems'); textCb.cb.checked = s.use_textbook !== false;
    cs.append(scopeCb.wrap, textCb.wrap);
    cs.appendChild(el('div', { style: 'font-size:12.5px;margin-top:6px', text: 'Graded work students may go over with the AI (needs the review switch above):' }));
    const kinds = Array.isArray(s.review_kinds) ? s.review_kinds : ['exams', 'quizzes', 'assignments', 'arenas'];
    [['exams', 'Exams (including paper exams with the graded answer sheet)'], ['quizzes', 'Chapter quizzes'], ['assignments', 'Assignments'], ['arenas', 'Arenas']].forEach(([k, label]) => { kindCbs[k] = check(label); kindCbs[k].cb.checked = kinds.includes(k); cs.appendChild(kindCbs[k].wrap); });
  }
  let pmon, pmpause;
  if ('professor_mode' in s) {
    cs.appendChild(el('h4', { text: 'Asha as professor' }));
    cs.appendChild(el('div', { style: 'font-size:12.5px;opacity:.85', text: 'Off by default. When on, you can ask Asha in the chat to run the course for you: change exam open and close times, post announcements (up to 3 a day), finalize AI-proposed exam scores, and report results. She never overwrites a grade you have set, students cannot trigger any of this, and every action is logged and can be undone. The pause switch stops her at once.' }));
    pmon = check('Let Asha act as the professor in this course'); pmon.cb.checked = !!s.professor_mode;
    pmpause = check('Pause Asha (kill switch: no actions while checked)'); pmpause.cb.checked = !!s.prof_paused;
    cs.append(pmon.wrap, pmpause.wrap);
  }
  let ap, apcb = {}, apnum = {};
  if (s.autopilot && typeof s.autopilot === 'object') {
    ap = s.autopilot;
    cs.appendChild(el('h4', { text: 'Autopilot: let Asha run the course while you are away' }));
    cs.appendChild(el('div', { style: 'font-size:12.5px;opacity:.85', text: 'Needs "Let Asha act as the professor" above. Asha checks every few minutes and does only the jobs you tick. Everything she does appears in "What Asha did" with an Undo button, and the Pause box stops it all. Final course grades are never changed automatically.' }));
    [['remind', 'Post reminders before exams, assignments and quizzes close'], ['finalize_exams', 'Finalize AI-graded exam scores after an exam closes'], ['grade_assignments', 'Grade written assignments after the due date (Asha proposes a score and feedback, then releases them)'], ['answer_questions', 'Answer student questions she is confident about (the rest wait for you)']].forEach(([k, label]) => { apcb[k] = check(label); apcb[k].cb.checked = ap[k] === true; cs.appendChild(apcb[k].wrap); });
    [['remind_hours', 'Remind this many hours before a deadline', 1, 168], ['finalize_delay_min', 'Wait this many minutes after an exam closes before finalizing', 0, 10080], ['grade_delay_min', 'Wait this many minutes after the due date before grading', 0, 10080]].forEach(([k, label, lo, hi]) => { apnum[k] = el('input', { type: 'number', min: lo, max: hi, value: ap[k] }); cs.appendChild(field(label, apnum[k])); });
    const take = btn('Turn everything on (take over the course)');
    take.onclick = () => { Object.keys(apcb).forEach((k) => { apcb[k].cb.checked = true; }); if (pmon) pmon.cb.checked = true; if (pmpause) pmpause.cb.checked = false; smsg.say('All autopilot jobs ticked. Press Save settings to start.', 'ok'); };
    cs.appendChild(take);
  }
  if ('professor_mode' in s) {
    cs.appendChild(el('h4', { text: 'Live class schedule' }));
    cs.appendChild(el('div', { style: 'font-size:12.5px;opacity:.85', text: 'Asha opens the class at the scheduled time, moves through your sections at an even pace, and closes it at the end. Students see a "Join class" banner in the AI Instructor; joining records attendance (present = joined and stayed at least half the class). Needs Asha as professor switched on above.' }));
    const sc = el('div', { style: 'display:grid;gap:6px;margin:6px 0' }); cs.appendChild(sc);
    const smsg2 = msg();
    const stitle = el('input', { type: 'text', maxlength: 160, placeholder: 'Class title, e.g. Macroeconomics lecture' });
    const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; const dcb = DN.map((d) => { const c = check(d); return c; });
    const drow = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }); dcb.forEach((c) => drow.appendChild(c.wrap));
    const stime = el('input', { type: 'time', value: '10:00' }); const smin = el('input', { type: 'number', min: 10, max: 240, value: 75 });
    const stz = el('input', { type: 'text', value: 'America/New_York', maxlength: 64 });
    const sout = el('textarea', { rows: 6, maxlength: 3000, placeholder: 'One section per line (up to 20), e.g.\nWhat GDP measures\nNominal vs real GDP\nGDP deflator\nWorked example' });
    const sauto = check('Start the class automatically at the scheduled time'); sauto.cb.checked = true;
    sc.append(field('Title', stitle), el('div', { text: 'Days' }), drow, field('Start time', stime), field('Length (minutes)', smin), field('Time zone (IANA name)', stz), field('Sections', sout), sauto.wrap);
    const ssv = btn('Save class schedule'), sclr = btn('Remove schedule');
    const sbar = el('div', { style: 'display:flex;gap:8px;margin-top:4px' }); sbar.append(ssv, sclr); cs.append(sbar, smsg2);
    (async () => { try { const r = await call({ action: 'prof_schedule_get', course_id: cid }); const x = r && r.schedule; if (x) {
      stitle.value = x.title || ''; (x.days || []).forEach((d) => { if (dcb[d]) dcb[d].cb.checked = true; }); stime.value = String(x.start_local || '10:00').slice(0, 5); smin.value = x.duration_min; stz.value = x.tz || 'America/New_York';
      sout.value = (x.outline || []).map((o) => (o && o.title) || '').join('\n'); sauto.cb.checked = x.auto !== false; smsg2.say('A schedule is set.', 'ok'); } } catch (e) { /* not available yet */ } })();
    ssv.onclick = async () => {
      try {
        const days = dcb.map((c, i) => (c.cb.checked ? i : -1)).filter((i) => i >= 0);
        const outline = sout.value.split('\n').map((t) => t.trim()).filter(Boolean);
        await call({ action: 'prof_schedule_set', course_id: cid, title: stitle.value.trim(), outline, days, start: stime.value, minutes: Math.round(+smin.value), tz: stz.value.trim(), auto: sauto.cb.checked });
        smsg2.say('Saved. Make sure "Let Asha act as the professor" is on and saved.', 'ok');
      } catch (e) { smsg2.say(e.message, 'bad'); }
    };
    sclr.onclick = async () => { try { await call({ action: 'prof_schedule_clear', course_id: cid }); smsg2.say('Schedule removed.', 'ok'); } catch (e) { smsg2.say(e.message, 'bad'); } };

    cs.appendChild(el('h4', { text: 'Class attendance' }));
    const att = el('div', { style: 'font-size:13px' }); const abtn = btn('Show attendance'); cs.append(abtn, att);
    abtn.onclick = async () => {
      att.textContent = 'Loading...';
      try {
        const r = await call({ action: 'prof_attendance', course_id: cid }); att.textContent = '';
        if (!r.classes.length) { att.textContent = 'No classes yet.'; return; }
        r.classes.forEach((c) => {
          const box = el('div', { style: 'margin:8px 0;padding:8px;border:1px solid rgba(128,128,128,.35);border-radius:8px' });
          box.appendChild(el('div', { style: 'font-weight:600', text: c.title + ' - ' + new Date(c.started_at).toLocaleString() + (c.status === 'live' ? ' (live now)' : '') }));
          box.appendChild(el('div', { text: c.present + ' present, ' + c.joined + ' joined of ' + r.enrolled + ' enrolled; ' + c.questions + ' question(s) asked' }));
          if (c.students && c.students.length) box.appendChild(el('div', { style: 'opacity:.85;margin-top:4px', text: c.students.map((x) => x.name + ' ' + x.minutes + ' min' + (x.present ? '' : ' (not present)')).join('; ') }));
          att.appendChild(box);
        });
      } catch (e) { att.textContent = e.message; }
    };
  }
  const ssave = btn('Save settings');
  cs.append(ssave, smsg);
  ssave.onclick = async () => {
    try {
      const b = { action: 'set_settings', course_id: cid, enabled: en.cb.checked, retention_days: +ret.value, student_daily_tokens: +tok.value, course_monthly_usd: +usd.value };
      if (hasReview) { b.review_enabled = rven.cb.checked; b.review_show_solutions = rvsol.cb.checked; }
      if (hasScope) { b.scope_mode = scopeCb.cb.checked ? 'course_only' : 'open'; b.use_textbook = textCb.cb.checked; b.review_kinds = Object.keys(kindCbs).filter((k) => kindCbs[k].cb.checked); }
      if (pmon) { b.professor_mode = pmon.cb.checked; b.prof_paused = pmpause.cb.checked; }
      if (ap) { b.autopilot = {}; Object.keys(apcb).forEach((k) => { b.autopilot[k] = apcb[k].cb.checked; }); Object.keys(apnum).forEach((k) => { b.autopilot[k] = Math.round(+apnum[k].value) || 0; }); }
      await call(b); smsg.say('Saved.', 'ok');
    } catch (e) { smsg.say(e.message, 'bad'); }
  };

  // ---- Meeting requests ----
  if (hasReview) {
    const rc = el('div', { class: 'card' });
    rc.appendChild(el('h3', { text: 'Meeting requests from students' }));
    const list = el('div'), rmsg = msg(); rc.append(list, rmsg); host.appendChild(rc);
    const load = async () => {
      list.textContent = '';
      try {
        const j = await call({ action: 'list_review_requests', course_id: cid });
        if (my !== token) return;
        const rs = j.requests || [];
        if (!rs.length) { list.textContent = 'No requests.'; return; }
        rs.forEach((r) => {
          const row = el('p', { text: (r.status === 'open' ? 'OPEN – ' : 'Done – ') + r.student + ' would like to meet ' + (r.with === 'ta' ? 'the TA' : 'the professor') + ': ' + r.topic + (r.note ? ' (' + r.note + ')' : '') + ' – ' + new Date(r.created_at).toLocaleString() + ' ' });
          if (r.status === 'open') {
            const b = btn('Mark done', true);
            b.onclick = async () => { b.disabled = true; try { await call({ action: 'complete_review_request', course_id: cid, request_id: r.id }); load(); } catch (e) { rmsg.say(e.message, 'bad'); b.disabled = false; } };
            row.appendChild(b);
          }
          list.appendChild(row);
        });
      } catch (e) { rmsg.say(e.message, 'bad'); }
    };
    load();
  }
  // ---- Asha as professor: what she did, with undo (shown only where professor mode exists) ----
  if ('professor_mode' in s) {
    const pc = el('div', { class: 'card' });
    pc.appendChild(el('h3', { text: 'What Asha did (professor mode)' }));
    pc.appendChild(el('div', { style: 'font-size:12.5px;opacity:.85', text: 'Every action she takes for you, newest first. Undo restores the earlier value. Grade changes are held one hour before they apply; undo within that hour cancels them.' }));
    const plist = el('div'), pmsg = msg(), rbtn = btn('Refresh', true); pc.append(rbtn, plist, pmsg); host.appendChild(pc);
    const LABEL = { exam_window: 'Changed an exam window', announce: 'Posted an announcement', finalize: 'Finalized exam scores', assignment_create: 'Created an assignment', assignment_update: 'Changed an assignment', deadline: 'Set a closing time', feedback_propose: 'Proposed assignment feedback', feedback_finalize: 'Finalized assignment grades', grade_override_queued: 'Queued a grade change (on hold)', grade_override: 'Applied a grade change', answer_question: 'Answered a student question', class_start: 'Started a live class', class_step: 'Moved the live class', class_end: 'Ended the live class', standing_set: 'Changed a standing instruction', syllabus_save: 'Published the syllabus', lectures_plan: 'Planned the live lectures', exam_create: 'Created an exam', final_grades_queued: 'Queued final grades (on hold)', term_schedule: 'Scheduled quizzes, arenas and assignments' };
    const loadLog = async () => {
      plist.textContent = '';
      try {
        const j = await call({ action: 'prof_log', course_id: cid });
        if (my !== token) return;
        const as = j.actions || [];
        if (!as.length) { plist.textContent = 'Nothing yet.'; return; }
        as.forEach((a) => {
          const row = el('p', { text: new Date(a.at).toLocaleString() + ' – ' + (LABEL[a.action] || a.action) + (a.params && a.params.title ? ': ' + a.params.title : '') + (a.trigger && a.trigger !== 'professor' ? ' (' + a.trigger + ')' : '') + (a.status === 'undone' ? ' – undone' : '') + ' ' });
          if (a.status === 'done' && a.action !== 'class_end') {
            const b = btn('Undo', true);
            b.onclick = async () => { b.disabled = true; try { await call({ action: 'prof_undo', course_id: cid, action_id: a.id }); loadLog(); } catch (e) { pmsg.say(e.message, 'bad'); b.disabled = false; } };
            row.appendChild(b);
          }
          plist.appendChild(row);
        });
      } catch (e) { pmsg.say(e.message, 'bad'); }
    };
    rbtn.onclick = loadLog; loadLog();
  }
  refresh();
}

// ---- Subscriptions page (platform administrator only): who pays for the AI instructor ----------------------------------------------
// Shows whether the platform key is saved, links to the key form, and lets the administrator choose, per course, whether the
// course owner's own key pays (default) or MacroNations' platform key pays. The server enforces administrator-only; this card is only a convenience.
let subToken = 0;
async function renderPayer(host) {
  const st = window.State || {};
  if (st.role !== 'admin' || !host || host.querySelector('#aiPayerCard')) return;
  const my = ++subToken;
  const card = el('div', { class: 'card', id: 'aiPayerCard', style: 'margin-bottom:16px' });
  card.appendChild(el('h3', { text: 'AI instructor: who pays' }));
  const keyLine = el('div', { text: 'Checking the platform key…', style: 'font-size:13px;margin:6px 0' });
  card.appendChild(keyLine);
  const manage = btn('Add or replace the platform AI key', true);
  manage.onclick = () => { const n = document.querySelector('.nav-item[data-view="' + VIEW + '"]'); if (n) n.click(); };
  card.appendChild(manage);
  const first = host.firstElementChild; if (first && first.nextSibling) host.insertBefore(card, first.nextSibling); else host.appendChild(card);
  try {
    const j = await call({ action: 'key_status' });
    if (my !== subToken) return;
    keyLine.textContent = j.has_key
      ? 'Platform key on file ending in ' + j.last4 + ' (saved under your administrator account, model ' + j.model + ').'
      : 'No platform key saved yet. Save one with the button below while signed in as the administrator; courses cannot use "MacroNations pays" until then.';
  } catch (e) { keyLine.textContent = e.message; }
  const cid = st.teachCourseId;
  if (!cid) { card.appendChild(el('div', { text: 'Select a course to choose who pays for its AI instructor.', style: 'font-size:12.5px;opacity:.8;margin-top:8px' })); return; }
  const smsg = msg();
  let s;
  try { const j = await call({ action: 'get_settings', course_id: cid }); s = j.settings || j; }
  catch (e) { card.appendChild(smsg); smsg.say(e.message, 'bad'); return; }
  if (my !== subToken) return;
  if (!('payer' in s)) { card.appendChild(el('div', { text: 'This server version does not have the payer setting yet.', style: 'font-size:12.5px;opacity:.8' })); return; }
  const sel = el('select');
  sel.appendChild(el('option', { value: 'instructor', text: 'The course owner’s own AI key pays (default)' }));
  sel.appendChild(el('option', { value: 'platform', text: 'MacroNations pays (platform key)' }));
  sel.value = s.payer === 'platform' ? 'platform' : 'instructor';
  const save = btn('Save for this course');
  card.append(field('For the selected course', sel),
    el('div', { text: 'With “MacroNations pays”, every student’s questions are billed to the platform key. The course’s monthly spending cap (AI Instructor tab) is still enforced; currently $' + s.course_monthly_usd + ' per month.', style: 'font-size:12.5px;opacity:.85' }),
    save, smsg);
  save.onclick = async () => {
    try { await call({ action: 'set_settings', course_id: cid, payer: sel.value }); smsg.say('Saved.', 'ok'); }
    catch (e) { smsg.say(e.message, 'bad'); }
  };
}

function install() {
  const group = document.getElementById('teachGroup');
  if (!group || group.querySelector('[data-view="' + VIEW + '"]')) return !!group;
  const item = document.createElement('div');
  item.className = 'nav-item';
  item.setAttribute('data-view', VIEW);
  item.setAttribute('role', 'button');
  item.setAttribute('tabindex', '0');
  const ico = document.createElement('span'); ico.className = 'ico'; ico.setAttribute('aria-hidden', 'true'); ico.textContent = '🤖';
  item.append(ico, document.createTextNode(' AI Instructor'));
  const flags = group.querySelector('[data-view="flags"]');
  if (flags && flags.nextSibling) group.insertBefore(item, flags.nextSibling); else group.appendChild(item);
  const go = () => {
    document.querySelectorAll('.nav-item').forEach((x) => { x.classList.remove('active'); x.removeAttribute('aria-current'); });
    item.classList.add('active'); item.setAttribute('aria-current', 'page');
    window.switchView(VIEW);
  };
  item.addEventListener('click', go);
  item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  // TAs who are not the owner never see it.
  const sync = () => { const s = window.State || {}; item.classList.toggle('hidden', !!s.isTA && s.role !== 'instructor' && s.role !== 'professor' && s.role !== 'admin'); };
  sync();
  new MutationObserver(sync).observe(group, { attributes: true, attributeFilter: ['class'] });
  const pick = document.getElementById('coursePick'); if (pick) pick.addEventListener('change', sync);
  return true;
}

function wire() {
  if (typeof window.switchView !== 'function' || typeof window.rerenderCurrentView !== 'function') return false;
  if (window.VIEW_META && !window.VIEW_META[VIEW]) window.VIEW_META[VIEW] = ['AI Instructor', 'Connect your AI key, choose settings for this course, and manage review requests.', true];
  const orig = window.rerenderCurrentView;
  window.rerenderCurrentView = function () {
    orig.apply(this, arguments);
    if (window.currentView === VIEW) { const h = document.getElementById('viewHost'); if (h) render(h); }
    else if (window.currentView === 'subscriptions') { const h = document.getElementById('viewHost'); if (h) renderPayer(h); }
  };
  return install();
}

if (!wire()) {
  let tries = 0;
  const t = setInterval(() => { if (wire() || ++tries > 50) clearInterval(t); }, 200);
}
