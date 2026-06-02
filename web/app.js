// brik studio — frontend (vanilla, nessun build step)

const $ = (id) => document.getElementById(id);
const messages = $('messages');
const input = $('input');
const frame = $('frame');
const placeholder = $('placeholder');
const busy = $('busy');
const busyText = $('busyText');
const statusPill = $('statusPill');
const versionTag = $('versionTag');
const routesEl = $('routes');
const projectSelect = $('projectSelect');
const approveBtn = $('approveBtn');
const publishBtn = $('publishBtn');
const revertBtn = $('revertBtn');
const sendBtn = $('send');
const ownerEmail = $('ownerEmail');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let intakeActive = false;
let pendingCreate = null;
function disableSend(on) {
  sendBtn.disabled = on;
  input.disabled = on;
}

let currentId = null;
let currentStatus = null;

// ---------- util ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = { ok: false, error: { message: 'risposta non valida' } }; }
  return data;
}

function addMsg(role, html, extraClass = '') {
  const div = document.createElement('div');
  div.className = `msg ${role} ${extraClass}`.trim();
  div.innerHTML = html;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function thinking(text) {
  return addMsg('bot', `<p class="dotting">${escapeHtml(text)}</p>`, 'thinking');
}

function setBusy(on, text) {
  if (text) busyText.textContent = text;
  busy.hidden = !on;
  sendBtn.disabled = on;
  input.disabled = on;
  if (on) {
    approveBtn.disabled = publishBtn.disabled = revertBtn.disabled = true;
  } else {
    applyStatusButtons();
  }
}

function applyStatusButtons() {
  const has = !!currentId;
  revertBtn.disabled = !has;
  approveBtn.disabled = !has || currentStatus === 'approved' || currentStatus === 'published';
  publishBtn.disabled = !has || !(currentStatus === 'approved' || currentStatus === 'published');
}

function renderState(data) {
  const st = data.state;
  currentId = st.id;
  currentStatus = st.status;
  statusPill.className = `pill ${st.status}`;
  statusPill.textContent = st.status === 'preview' ? 'bozza' : st.status === 'approved' ? 'approvato' : 'pubblicato';
  versionTag.textContent = 'v' + st.version;
  routesEl.innerHTML = '';
  for (const r of st.routes) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = r.route === '/' ? 'home' : r.route;
    chip.title = r.label;
    chip.onclick = () => navPreview(st.id, r.route, st.version);
    routesEl.appendChild(chip);
  }
  applyStatusButtons();
}

function loadPreview(id, version) {
  placeholder.hidden = true;
  frame.hidden = false;
  frame.src = `/preview/${encodeURIComponent(id)}/?v=${version}&t=${Date.now()}`;
}
function navPreview(id, route, version) {
  const path = route === '/' ? '' : route.replace(/^\//, '');
  frame.hidden = false;
  placeholder.hidden = true;
  frame.src = `/preview/${encodeURIComponent(id)}/${path}?v=${version}&t=${Date.now()}`;
}

function summaryHtml(summary) {
  const lines = summary.pages
    .map((p) => {
      const bits = [];
      if (p.contents && p.contents.length) bits.push(p.contents.map((c) => `“${c}”`).join(', '));
      if (p.form) bits.push(`form [${p.form.fields.join(', ')}] → “${p.form.confirmation}”`);
      const detail = bits.length ? ' — ' + bits.join(' · ') : '';
      const label = p.route === '/' ? 'home' : p.label;
      return `<li><span class="tiny">${escapeHtml(p.route)}</span> ${escapeHtml(label)}${escapeHtml(detail)}</li>`;
    })
    .join('');
  return `<p><strong>${escapeHtml(summary.title)}</strong></p><ul>${lines}</ul>`;
}

// ---------- progetti ----------
async function refreshProjects(selected) {
  const data = await api('GET', '/api/projects');
  projectSelect.innerHTML = '<option value="">— progetti —</option>';
  if (data.ok) {
    for (const p of data.projects) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.title || p.id} · v${p.version} · ${p.status}`;
      projectSelect.appendChild(opt);
    }
  }
  if (selected) projectSelect.value = selected;
}

// ---------- azioni ----------
async function beginCreate(description, email) {
  addMsg('user', escapeHtml(description));
  pendingCreate = { description, email };
  intakeActive = true;
  disableSend(true);
  const t = thinking('Preparo un paio di domande');
  const data = await api('POST', '/api/intake', { description });
  t.remove();
  const qs = data && data.ok && Array.isArray(data.questions) ? data.questions : [];
  if (qs.length) {
    renderIntake(qs);
  } else {
    intakeActive = false;
    disableSend(false);
    createSite(description, email, []);
  }
}

function renderIntake(questions) {
  const wrap = document.createElement('div');
  wrap.className = 'msg bot intake';
  const intro = document.createElement('p');
  intro.textContent = 'Un paio di precisazioni per fare le cose giuste (puoi anche saltarle):';
  wrap.appendChild(intro);

  const answers = questions.map(() => '');
  questions.forEach((q, qi) => {
    const block = document.createElement('div');
    block.className = 'q-block';
    const qp = document.createElement('p');
    qp.className = 'q';
    qp.textContent = q.question;
    block.appendChild(qp);

    const ti = document.createElement('input');
    ti.type = 'text';
    ti.className = 'q-text';
    ti.placeholder = 'oppure scrivi…';
    ti.addEventListener('input', () => {
      answers[qi] = ti.value.trim();
      block.querySelectorAll('.opt').forEach((o) => o.classList.remove('sel'));
    });

    if (Array.isArray(q.options) && q.options.length) {
      const opts = document.createElement('div');
      opts.className = 'opts';
      q.options.forEach((opt) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'opt';
        b.textContent = opt;
        b.addEventListener('click', () => {
          opts.querySelectorAll('.opt').forEach((o) => o.classList.remove('sel'));
          b.classList.add('sel');
          answers[qi] = opt;
          ti.value = '';
        });
        opts.appendChild(b);
      });
      block.appendChild(opts);
    }
    block.appendChild(ti);
    wrap.appendChild(block);
  });

  const build = document.createElement('button');
  build.className = 'btn accent build-btn';
  build.textContent = 'Costruisci';
  build.addEventListener('click', () => {
    if (!pendingCreate) return;
    const collected = questions
      .map((q, i) => ({ question: q.question, answer: answers[i] }))
      .filter((a) => a.answer);
    wrap.querySelectorAll('button, input').forEach((e) => (e.disabled = true));
    build.textContent = 'Costruisco…';
    intakeActive = false;
    disableSend(false);
    const { description, email } = pendingCreate;
    pendingCreate = null;
    createSite(description, email, collected);
  });
  wrap.appendChild(build);

  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
}

async function createSite(description, email, answers) {
  const t = thinking('Costruisco il sito');
  setBusy(true, 'Sto costruendo…');
  const data = await api('POST', '/api/projects', { description, email, answers: answers || [] });
  t.remove();
  setBusy(false);
  if (!data.ok) return addMsg('bot', `<p>Non sono riuscito a costruire il sito.</p><p class="tiny">${escapeHtml(data.error?.message || '')}</p>`, 'err');
  renderState(data);
  ownerEmail.classList.add('hidden');
  loadPreview(data.id, data.state.version);
  await refreshProjects(data.id);
  addMsg('bot', `<p>Fatto — sito costruito e verificato. I messaggi del form arriveranno a <strong>${escapeHtml(email)}</strong> dopo la pubblicazione.</p>${summaryHtml(data.summary)}<p class="tiny">Guardalo nell'anteprima. Chiedimi modifiche, oppure Approva e Pubblica.</p>`, 'ok-note');
}

async function editSite(instruction) {
  addMsg('user', escapeHtml(instruction));
  const t = thinking('Applico la modifica');
  setBusy(true, 'Applico la modifica…');
  const data = await api('POST', `/api/projects/${encodeURIComponent(currentId)}/edit`, { instruction });
  t.remove();
  setBusy(false);
  if (!data.ok) return addMsg('bot', `<p>Modifica non riuscita.</p><p class="tiny">${escapeHtml(data.error?.message || '')}</p>`, 'err');
  renderState(data);
  if (data.accepted) {
    loadPreview(currentId, data.state.version);
    await refreshProjects(currentId);
    const changes = (data.changes || []).length
      ? `<p class="tiny">Modifiche: ${escapeHtml(data.changes.join(' · '))}</p>`
      : '';
    addMsg('bot', `<p>Modifica applicata.</p>${changes}${summaryHtml(data.summary)}`, 'ok-note');
  } else {
    const list = (data.conflicts || []).map((c) => `<li>${escapeHtml(c.detail || c.kind)}</li>`).join('');
    addMsg('bot', `<p>Non posso applicarla: romperebbe qualcosa che avevi già chiesto.</p><ul>${list}</ul><p class="tiny">Il sito resta com'era. Riformula la richiesta o cambia il requisito esplicitamente.</p>`, 'err');
  }
}

async function approve() {
  const data = await api('POST', `/api/projects/${encodeURIComponent(currentId)}/approve`);
  if (!data.ok) return addMsg('bot', `<p class="tiny">${escapeHtml(data.error?.message || 'errore')}</p>`, 'err');
  renderState(data);
  addMsg('bot', '<p>Approvato. Ora puoi pubblicarlo online.</p>');
}

async function publish() {
  const t = thinking('Pubblico online');
  setBusy(true, 'Pubblico online…');
  const data = await api('POST', `/api/projects/${encodeURIComponent(currentId)}/publish`);
  t.remove();
  setBusy(false);
  if (!data.ok) return addMsg('bot', `<p>Pubblicazione non riuscita.</p><p class="tiny">${escapeHtml(data.error?.message || '')}</p>`, 'err');
  renderState(data);
  if (data.published) {
    const url = data.state.url;
    const link = url ? `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></p>` : '';
    const note = data.deliveryActive === false
      ? `<p class="tiny">Attenzione: il recapito del form NON è attivo (manca RESEND_API_KEY nel .env). Imposta la chiave e ripubblica perché i messaggi arrivino.</p>`
      : '';
    addMsg('bot', `<p>Pubblicato.</p>${link}${note}`, 'ok-note');
  } else {
    const list = (data.findings || []).map((f) => `<li><span class="tiny">${escapeHtml(f.route)}</span> ${escapeHtml(f.severity)} · ${escapeHtml(f.code)} ×${f.count}</li>`).join('');
    addMsg('bot', `<p>Pubblicazione bloccata dal controllo di sicurezza:</p><ul>${list}</ul>`, 'err');
  }
}

async function revert() {
  const data = await api('POST', `/api/projects/${encodeURIComponent(currentId)}/revert`);
  if (!data.ok) return addMsg('bot', `<p class="tiny">${escapeHtml(data.error?.message || 'errore')}</p>`, 'err');
  renderState(data);
  loadPreview(currentId, data.state.version);
  addMsg('bot', `<p>Ripristinata la versione precedente (v${data.state.version}).</p>`);
}

async function openProject(id) {
  const data = await api('GET', `/api/projects/${encodeURIComponent(id)}`);
  if (!data.ok) return addMsg('bot', `<p class="tiny">${escapeHtml(data.error?.message || 'errore')}</p>`, 'err');
  renderState(data);
  ownerEmail.classList.add('hidden');
  loadPreview(id, data.state.version);
  addMsg('bot', `<p>Caricato.</p>${summaryHtml(data.summary)}`);
}

function resetToNew() {
  currentId = null;
  currentStatus = null;
  intakeActive = false;
  pendingCreate = null;
  disableSend(false);
  projectSelect.value = '';
  statusPill.className = 'pill empty';
  statusPill.textContent = 'nessun progetto';
  versionTag.textContent = '';
  routesEl.innerHTML = '';
  frame.hidden = true;
  frame.removeAttribute('src');
  placeholder.hidden = false;
  ownerEmail.value = '';
  ownerEmail.classList.remove('hidden');
  applyStatusButtons();
  addMsg('bot', '<p>Pronto. Inserisci l\'email di recapito e descrivi il nuovo sito.</p>');
}

// ---------- eventi ----------
$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || sendBtn.disabled) return;
  if (currentId) {
    input.value = '';
    editSite(text);
  } else {
    const email = ownerEmail.value.trim();
    if (!EMAIL_RE.test(email)) {
      addMsg('bot', '<p>Inserisci un\'email valida dove ricevere i messaggi del form, poi invia di nuovo.</p>', 'err');
      ownerEmail.focus();
      return;
    }
    input.value = '';
    beginCreate(text, email);
  }
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('composer').requestSubmit();
  }
});

$('newBtn').addEventListener('click', resetToNew);
projectSelect.addEventListener('change', () => { if (projectSelect.value) openProject(projectSelect.value); });
approveBtn.addEventListener('click', approve);
publishBtn.addEventListener('click', publish);
revertBtn.addEventListener('click', revert);

refreshProjects();
