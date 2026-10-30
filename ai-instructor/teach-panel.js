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
  const ssave = btn('Save settings');
  cs.append(ssave, smsg);
  ssave.onclick = async () => {
    try {
      const b = { action: 'set_settings', course_id: cid, enabled: en.cb.checked, retention_days: +ret.value, student_daily_tokens: +tok.value, course_monthly_usd: +usd.value };
      if (hasReview) { b.review_enabled = rven.cb.checked; b.review_show_solutions = rvsol.cb.checked; }
      if (hasScope) { b.scope_mode = scopeCb.cb.checked ? 'course_only' : 'open'; b.use_textbook = textCb.cb.checked; b.review_kinds = Object.keys(kindCbs).filter((k) => kindCbs[k].cb.checked); }
      if (pmon) { b.professor_mode = pmon.cb.checked; b.prof_paused = pmpause.cb.checked; }
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
