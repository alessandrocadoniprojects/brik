// brik studio — frontend (vanilla, nessun build step)

const $ = (id) => document.getElementById(id);
const messages = $('messages');
const input = $('input');
const frame = $('frame');
const placeholder = $('placeholder');
const busy = $('busy');
const busyText = $('busyText');
const busyBar = $('busybar');
const busyTime = $('busytime');
const statusPill = $('statusPill');
const versionTag = $('versionTag');
const routesEl = $('routes');
const projBtn = $('projBtn');
const projMenu = $('projMenu');
let projectList = [];
const publishBtn = $('publishBtn');
const revertBtn = $('revertBtn');
const sendBtn = $('send');
const editBtn = $('editBtn');
const themeSelect = $('themeSelect');
const accentSwatches = $('accentSwatches');
const accentColor = $('accentColor');
const settingsBtn = $('settingsBtn');
const settings = $('settings');
const settingsClose = $('settingsClose');
const ownerEmailInput = $('ownerEmailInput');
const emailSave = $('emailSave');
const legalNameInput = $('legalNameInput');
const legalVatInput = $('legalVatInput');
const legalAddrInput = $('legalAddrInput');
const legalSave = $('legalSave');
const addrRow = $('addrRow');
const ownerAddrInput = $('ownerAddrInput');
const addrSave = $('addrSave');
const settingsSave = $('settingsSave');
const settingsMsg = $('settingsMsg');
const addrNote = $('addrNote');
const conciergeBtn = $('conciergeBtn');
const cdInput = $('cdInput');
const cdLink = $('cdLink');
const cdPanel = $('cdPanel');
const cdMsg = $('cdMsg');
const customDomainRow = $('customDomainRow');
const mobileTabs = $('mobileTabs');
const ctxbar = $('ctxbar');
const askbar = $('askbar');
const askForm = $('askForm');
const askInput = $('askInput');
const landing = $('landing');
const landingForm = $('landingForm');
const landingInput = $('landingInput');
const landingChips = $('landingChips');
const imgpanel = $('imgpanel');
const attachBtn = $('attachBtn');
const fileInput = $('fileInput');
const attachList = $('attachList');

// Allegati in chat (fase TESTO): file -> testo estratto lato server -> materiale per la prima bozza.
const MAX_ATTACH = 20;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
let attachments = []; // { id, name, status:'loading'|'ready'|'error'|'empty', text, chars, truncated, error }
let attachSeq = 0;

let intakeActive = false;
let pendingCreate = null;
let pendingStartingPoint = null;
let pendingPizzeriaAnswers = null;
function disableSend(on) {
  sendBtn.disabled = on;
  input.disabled = on;
}

let currentId = null;
let currentStatus = null;
let currentPending = [];
let editMode = false;
let _editHintShown = false;
let currentRoute = '/';
let currentTheme = 'editorial-luxury';
let currentAccent = null;
let currentEmail = '';
let currentLegal = {};
let authUser = null; // utente loggato (da /api/auth/me); null = ospite
let currentUrl = '';
let swatchesBuilt = false;
const ACCENTS = ['#5B8CFF', '#BE3A23', '#1E8E6A', '#7C5CFF', '#E0A21B', '#D81B7A', '#0EA5B5'];

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
  if (data && data.ok === false && data.error && data.error.code === 'NEEDS_AUTH') {
    try { promptAuth(data.error.message); } catch (e) {}
  }
  return data;
}

async function startCheckout() {
  if (!currentId) return;
  try { if (window.fbq) fbq('track', 'InitiateCheckout', { value: 19, currency: 'EUR' }); } catch (e) {}
  try {
    const r = await api('POST', '/api/projects/' + encodeURIComponent(currentId) + '/checkout');
    if (r && r.ok && r.url) { window.location.href = r.url; return; }
    addMsg('bot', `<p>Non riesco ad avviare il pagamento.</p><p class="tiny">${escapeHtml((r && r.error && r.error.message) || '')}</p>`, 'err');
  } catch (e) {
    addMsg('bot', `<p>Errore nell'avvio del pagamento.</p>`, 'err');
  }
}

function addMsg(role, html, extraClass = '') {
  const div = document.createElement('div');
  div.className = `msg ${role} ${extraClass}`.trim();
  div.innerHTML = html;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  // Specchia nel box di Modifica così la chat ha lo storico, come la vecchia sezione chat.
  const log = document.getElementById('askLog');
  if (log) { log.appendChild(div.cloneNode(true)); log.scrollTop = log.scrollHeight; }
  return div;
}
// All'apertura della Modifica allinea lo storico della chat a quello della conversazione.
function syncAskLog() {
  const log = document.getElementById('askLog');
  if (log) { log.innerHTML = messages.innerHTML; log.scrollTop = log.scrollHeight; }
}

function clearChat() { messages.innerHTML = ''; }

const LAST_KEY = 'brik:lastProject';
function saveLastProject(id) { try { localStorage.setItem(LAST_KEY, id); } catch {} }
function clearLastProject() { try { localStorage.removeItem(LAST_KEY); } catch {} }
function readLastProject() { try { return localStorage.getItem(LAST_KEY); } catch { return null; } }
function hasProjectOption(id) { return projectList.some((p) => p.id === id); }

function setMobileView(view) {
  // "modifica" e "preview" mostrano entrambe il sito; cambia solo se l'editing è acceso.
  // "chat" resta per il flusso di creazione (conversazione), ma non ha più una scheda dedicata.
  const previewish = view === 'preview' || view === 'modifica';
  document.body.classList.toggle('view-preview', previewish);
  if (mobileTabs) mobileTabs.querySelectorAll('.mtab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (currentId) setEditMode(view === 'modifica');
}

function setAppHeight() {
  const root = document.documentElement.style;
  const vv = window.visualViewport;
  if (vv) {
    root.setProperty('--app-h', vv.height + 'px');
    root.setProperty('--vv-top', vv.offsetTop + 'px');
  } else {
    root.setProperty('--app-h', window.innerHeight + 'px');
    root.setProperty('--vv-top', '0px');
  }
}

function onMobile() { return window.matchMedia('(max-width: 820px)').matches; }

let sheetEl = null;
let txtSheet = null;
function buildTextSheet() {
  if (txtSheet) return txtSheet;
  const s = document.createElement('div');
  s.className = 'txt-sheet';
  s.hidden = true;
  s.innerHTML =
    '<div class="txt-sheet-head"><span class="txt-sheet-title">Modifica testo</span>' +
    '<button type="button" class="txt-sheet-cancel">Annulla</button></div>' +
    '<textarea class="txt-sheet-input" rows="2" autocapitalize="sentences"></textarea>' +
    '<button type="button" class="txt-sheet-save btn accent">Salva</button>';
  document.body.appendChild(s);
  s.querySelector('.txt-sheet-cancel').addEventListener('click', () => closeTextSheet(false));
  s.querySelector('.txt-sheet-save').addEventListener('click', () => closeTextSheet(true));
  txtSheet = s;
  return s;
}

function openTextSheet(el) {
  hideCtx();
  sheetEl = el;
  try { el.setAttribute('data-brik-sel', ''); el.scrollIntoView({ block: 'center' }); } catch {}
  const s = buildTextSheet();
  const ta = s.querySelector('.txt-sheet-input');
  ta.value = (el.innerText || el.textContent || '').trim();
  s.hidden = false;
  document.body.classList.add('sheet-open');
  setTimeout(() => { ta.focus(); }, 40);
}

function closeTextSheet(save) {
  const el = sheetEl;
  if (txtSheet) {
    if (save && el) { el.textContent = txtSheet.querySelector('.txt-sheet-input').value; }
    txtSheet.hidden = true;
  }
  if (el) { try { el.removeAttribute('data-brik-sel'); } catch {} }
  document.body.classList.remove('sheet-open');
  sheetEl = null;
  if (save && el) savePage();
}

function thinking(text) {
  return addMsg('bot', `<p class="dotting">${escapeHtml(text)}</p>`, 'thinking');
}

let progressTimer = null;
let progressStart = 0;
function startProgress() {
  progressStart = Date.now();
  if (busyBar) busyBar.style.width = '2%';
  if (busyTime) busyTime.textContent = '0s';
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    const s = (Date.now() - progressStart) / 1000;
    if (busyTime) busyTime.textContent = Math.floor(s) + 's';
    // avanzamento "guida" tarato sui tempi attuali (~30-45s): vicino al 95% sul completamento
    const pct = Math.min(95, 100 * (1 - Math.exp(-s / 20)));
    if (busyBar) busyBar.style.width = pct.toFixed(1) + '%';
  }, 250);
}
function stopProgress() {
  clearInterval(progressTimer);
  progressTimer = null;
  if (busyBar) busyBar.style.width = '100%';
}

function setBusy(on, text) {
  if (text) busyText.textContent = text;
  busy.hidden = !on;
  sendBtn.disabled = on;
  input.disabled = on;
  if (on) {
    publishBtn.disabled = revertBtn.disabled = true;
    if (editBtn) editBtn.disabled = true;
    startProgress();
  } else {
    stopProgress();
    applyStatusButtons();
  }
}

function applyStatusButtons() {
  const has = !!currentId;
  revertBtn.disabled = !has;
  publishBtn.disabled = !has || (currentPending && currentPending.length > 0); // gate: non pubblicabile finché le pagine interne sono in costruzione (server: 503 SITE_BUILDING)
  if (editBtn) editBtn.disabled = !has;
  if (settingsBtn) settingsBtn.disabled = !has;
  updateModeButtons();
}

// Mostra ogni pulsante dove ha senso: Annulla ultima in Modifica, Visita il sito in Anteprima,
// + Sezione solo mentre modifico (e con un sito aperto).
function updateModeButtons() {
  if (revertBtn) revertBtn.hidden = !editMode;
  if (publishBtn) publishBtn.hidden = editMode;
  const add = document.getElementById('addSectionTop');
  if (add) add.hidden = !(editMode && currentId);
}

const MAX_CHIPS = 6;
let markActiveRoute = () => {};

function routeTitle(r) {
  if (!r) return 'Pagine';
  if (r.route === '/') return 'Home';
  return r.label || r.route.replace(/^\//, '') || r.route;
}

function openPagesModal(st) {
  const ov = document.createElement('div');
  ov.className = 'modal';
  const rows = st.routes.map((r) => {
    const active = r.route === currentRoute;
    return '<button type="button" class="pages-item' + (active ? ' active' : '') + '" data-route="' + escapeHtml(r.route) + '">' +
      '<span class="pages-item-main"><span class="pages-item-name">' + escapeHtml(routeTitle(r)) + '</span>' +
      '<span class="pages-item-route">' + escapeHtml(r.route) + '</span></span>' +
      '<span class="pages-item-tag">' + (active ? 'in anteprima' : 'apri') + '</span>' +
      '</button>';
  }).join('');
  ov.innerHTML =
    '<div class="modal-card">' +
    '<div class="modal-head"><h3>Pagine del sito</h3><button class="icon-btn" data-act="close" aria-label="Chiudi">×</button></div>' +
    '<div class="pages-list">' + rows + '</div>' +
    '</div>';
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-act="close"]').addEventListener('click', close);
  ov.querySelectorAll('.pages-item').forEach((b) => {
    b.addEventListener('click', () => {
      const route = b.dataset.route;
      close();
      if (route !== currentRoute) navPreview(st.id, route, st.version);
    });
  });
}

function renderRoutes(st) {
  routesEl.innerHTML = '';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip routes-trigger';
  btn.setAttribute('aria-label', 'Apri l\'elenco delle pagine');
  const ico = '<svg class="rt-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/></svg>';
  const setLabel = () => {
    const cur = st.routes.find((r) => r.route === currentRoute) || st.routes[0];
    btn.innerHTML = ico + '<span class="rt-name">' + escapeHtml(routeTitle(cur)) + '</span>' +
      '<span class="rt-count">' + st.routes.length + '</span><span class="caret">▾</span>';
  };
  btn.onclick = (e) => { e.stopPropagation(); openPagesModal(st); };
  routesEl.appendChild(btn);
  markActiveRoute = setLabel;
  setLabel();
}

function renderState(data) {
  const st = data.state;
  currentId = st.id;
  currentStatus = st.status;
  currentUrl = st.url || '';
  try { updatePlanChip(st); } catch (e) {}
  renderGating(st);
  renderRoutes(st);
  // Fast Preview: se restano pagine interne in preparazione, avvia un polling leggero
  // che le sostituisce quando pronte, senza toccare la home gia visibile.
  if (st.pendingRoutes && st.pendingRoutes.length) startPendingPoll(st.id);
  applyStatusButtons();
  updateComposerMode();
  input.placeholder = 'Chiedi una modifica al sito… es. «cambia colore» o «aggiungi una pagina»';
}

function renderGating(st) {
  // Stato e prova non stanno più nella barra (serve spazio): finiscono nelle Impostazioni.
  currentPending = st.pendingRoutes || [];
  if (versionTag) versionTag.hidden = true; // versione: non serve all'utente
  // Fast Preview: il publish è gated finché le pagine interne sono in costruzione (pendingRoutes>0):
  // il server risponde 503 SITE_BUILDING. Il bottone resta disabilitato e si riattiva da solo quando
  // il polling rileva che le pagine sono pronte.
  if (publishBtn) {
    if (currentPending.length) {
      publishBtn.title = 'Sito ancora in costruzione, riprova fra qualche secondo…';
    } else if (publishBtn.title) {
      publishBtn.title = '';
    }
  }
  const statusLabel = st.status === 'preview' ? 'bozza' : st.status === 'approved' ? 'approvato' : st.status === 'locked' ? 'in pausa' : 'pubblicato';
  let trial = '';
  if (st.entitled) trial = 'attivo · nessun limite';
  else if (st.planActive) trial = 'piano attivo';
  else if (st.status !== 'locked') {
    const parts = [];
    if (st.trialPhase === 'trial' && st.trialDaysLeft != null) parts.push(st.trialDaysLeft + 'g di prova');
    const cap = st.editCap || 0; const left = st.editsLeft;
    if (cap > 0 && left != null) parts.push(left + '/' + cap + ' modifiche');
    trial = parts.join(' · ');
  }
  const ss = document.getElementById('settingsStatus');
  if (ss) ss.textContent = trial ? statusLabel + ' · ' + trial : statusLabel;
  // Nella barra mostro la pill SOLO se il sito è in pausa: è la scorciatoia per riattivarlo.
  if (statusPill) {
    if (st.status === 'locked' && !st.entitled) {
      statusPill.hidden = false;
      statusPill.className = 'pill locked';
      statusPill.textContent = 'in pausa · riattiva';
      statusPill.style.cursor = 'pointer'; statusPill.onclick = startCheckout; statusPill.title = 'Riattiva il sito';
    } else {
      statusPill.hidden = true; statusPill.onclick = null; statusPill.style.cursor = '';
    }
  }
}

let pendingTimer = null;
function refreshPreviewFrame() {
  if (!frame || !frame.src) return;
  frame.src = /[?&]t=\d+/.test(frame.src) ? frame.src.replace(/([?&]t=)\d+/, '$1' + Date.now()) : (frame.src + (frame.src.includes('?') ? '&' : '?') + 't=' + Date.now());
}
function refreshPreviewFrameVersion(version) {
  if (!frame || !frame.src) {
    if (currentId) loadPreview(currentId, version);
    return;
  }
  try {
    const u = new URL(frame.src, window.location.origin);
    u.searchParams.set('v', String(version || Date.now()));
    u.searchParams.set('t', String(Date.now()));
    frame.src = u.pathname + u.search;
  } catch {
    refreshPreviewFrame();
  }
}
// Polling leggero: aspetta che le pagine interne (pendingRoutes) siano pronte e poi
// ricarica l'iframe corrente. La home resta identica; cambiano solo le interne.
function startPendingPoll(id, { intervalMs = 3000, maxMs = 4 * 60_000 } = {}) {
  if (pendingTimer) return; // gia attivo
  const t0 = Date.now();
  pendingTimer = setInterval(async () => {
    if (Date.now() - t0 > maxMs || id !== currentId) { clearInterval(pendingTimer); pendingTimer = null; return; }
    let data;
    try { data = await api('GET', `/api/projects/${encodeURIComponent(id)}`); } catch { return; }
    if (!data || !data.ok || !data.state) return;
    const pending = data.state.pendingRoutes || [];
    if (!pending.length) {
      clearInterval(pendingTimer); pendingTimer = null;
      try { renderState(data); } catch (e) {} // riabilita publish/Visita il sito
      refreshPreviewFrame(); // le pagine interne ora sono reali
    }
  }, intervalMs);
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

// ---------- modifica diretta (nessun LLM) ----------
const TEXT_SELECTOR = 'h1,h2,h3,h4,p,span,a,li,button,blockquote,.eyebrow,.lead,.price,.num,.label,.who,.name,.desc,.brand,.footer-note';
const EDIT_STYLE =
  `.brik-editing :is(${TEXT_SELECTOR}):hover { outline: 2px dashed #5b8cff; outline-offset: 3px; cursor: text; }\n` +
  `.brik-editing img:hover { outline: 3px solid #5b8cff; outline-offset: 2px; cursor: pointer; filter: brightness(1.05); }\n` +
  `.brik-editing [data-brik-bg]:hover { outline: 3px solid #5b8cff; outline-offset: -3px; cursor: pointer; }\n` +
  `.brik-editing [contenteditable="true"] { outline: 2px solid var(--accent) !important; outline-offset: 3px; cursor: text; }\n` +
  `.brik-editing [data-brik-sel] { outline: 3px solid #5b8cff !important; outline-offset: 2px; }\n` +
  `@keyframes brikHintPulse { 0%,100% { outline-color: transparent; } 25%,75% { outline-color: #5b8cff; } }\n` +
  `.brik-editing [data-brik-hint] { outline: 3px solid #5b8cff; outline-offset: 3px; border-radius: 2px; animation: brikHintPulse .9s ease 2; }`;

const TEXT_COLORS = [
  { name: 'Auto', value: '' },
  { name: 'Scuro', value: 'var(--ink)' },
  { name: 'Tenue', value: 'var(--ink-soft)' },
  { name: 'Accento', value: 'var(--accent)' },
  { name: 'Chiaro', value: '#ffffff' },
];
const ICON = {
  alignLeft: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="13" y2="12"/><line x1="4" y1="17" x2="17" y2="17"/></svg>',
  alignCenter: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="6" y1="17" x2="18" y2="17"/></svg>',
  alignRight: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="11" y1="12" x2="20" y2="12"/><line x1="7" y1="17" x2="20" y2="17"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
};

let selectedEl = null;
let repositionCtx = () => {};

function frameDoc() { try { return frame.contentDocument; } catch { return null; } }
function frameWin() { try { return frame.contentWindow; } catch { return null; } }

function routeFromFrame() {
  const w = frameWin();
  if (!w) return currentRoute;
  try {
    const base = '/preview/' + currentId;
    let r = w.location.pathname.startsWith(base) ? w.location.pathname.slice(base.length) : '/';
    if (!r || r === '/index.html') r = '/';
    return r;
  } catch { return currentRoute; }
}

function readThemeAccent() {
  const doc = frameDoc();
  if (!doc) return;
  const ds = doc.querySelector('[data-brik-ds]');
  const th = ds && ds.getAttribute('data-brik-ds');
  if (th) { currentTheme = th; if (themeSelect) themeSelect.value = th; }
  const acc = getComputedStyle(doc.documentElement).getPropertyValue('--accent').trim();
  if (/^#[0-9a-f]{6}$/i.test(acc)) { currentAccent = acc; if (accentColor) accentColor.value = acc; }
  markActiveSwatch();
}

function hideCtx() {
  if (selectedEl) { try { selectedEl.removeAttribute('data-brik-sel'); selectedEl.removeAttribute('contenteditable'); } catch {} }
  selectedEl = null;
  if (ctxbar) ctxbar.hidden = true;
  if (imgpanel) imgpanel.hidden = true;
}

let askbarHintTimer = null;
function hasOwnText(node) {
  if (!node || node.nodeType !== 1) return false;
  for (let i = 0; i < node.childNodes.length; i++) {
    const n = node.childNodes[i];
    if (n.nodeType === 3 && n.textContent && n.textContent.trim()) return true;
  }
  return false;
}
function flashFrameEl(el) {
  try {
    el.setAttribute('data-brik-hint', '');
    setTimeout(() => { try { el.removeAttribute('data-brik-hint'); } catch {} }, 1100);
  } catch {}
}
function hintAskbar(el) {
  hideCtx();
  if (el) flashFrameEl(el);
  if (!askbar) return;
  askbar.hidden = false;
  try { askbar.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
  askbar.classList.remove('askbar-attn');
  void askbar.offsetWidth;
  askbar.classList.add('askbar-attn');
  clearTimeout(askbarHintTimer);
  askbarHintTimer = setTimeout(() => { try { askbar.classList.remove('askbar-attn'); } catch {} }, 1800);
}

function commitEdit() {
  const el = selectedEl;
  if (el && el.getAttribute && el.getAttribute('contenteditable') === 'true') {
    const w = frameWin(); if (w) { const s = w.getSelection(); if (s) s.removeAllRanges(); }
    try { el.blur(); } catch {} // onFrameBlur rimuove contenteditable e salva
  }
  hideCtx();
}

function positionCtx(el, panel) {
  const fw = frame.parentElement;
  const r = el.getBoundingClientRect();
  const w = panel.offsetWidth, h = panel.offsetHeight;
  let top = r.top - h - 8;
  if (top < 4) top = Math.min(r.bottom + 8, fw.clientHeight - h - 6);
  const left = Math.max(6, Math.min(r.left, fw.clientWidth - w - 6));
  panel.style.top = top + 'px';
  panel.style.left = left + 'px';
}

function positionCtxNear(x, y) {
  const fw = frame.parentElement;
  const w = ctxbar.offsetWidth, h = ctxbar.offsetHeight;
  let top = y - h - 12;
  if (top < 4) top = y + 16;
  let left = x - w / 2;
  left = Math.max(6, Math.min(left, fw.clientWidth - w - 6));
  top = Math.max(6, Math.min(top, fw.clientHeight - h - 6));
  ctxbar.style.top = top + 'px';
  ctxbar.style.left = left + 'px';
}

function ctxButton(html, title, onClick, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = html;
  if (title) b.title = title;
  if (cls) b.className = cls;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
  return b;
}

function setAlign(v) { if (selectedEl) { selectedEl.style.textAlign = v; savePage(); } }
function setColor(v) { if (selectedEl) { selectedEl.style.color = v; savePage(); } }
function toggleBold() {
  if (!selectedEl) return;
  const cur = selectedEl.style.fontWeight || getComputedStyle(selectedEl).fontWeight;
  const bold = cur === '700' || cur === 'bold' || Number(cur) >= 700;
  selectedEl.style.fontWeight = bold ? '400' : '700';
  savePage();
}
function deleteEl() { if (!selectedEl) { return; } const el = selectedEl; hideCtx(); el.remove(); savePage(); }

function toggleColorRow() {
  const existing = ctxbar.querySelector('.color-row');
  if (existing) { existing.remove(); repositionCtx(); return; }
  const row = document.createElement('span');
  row.className = 'color-row';
  row.style.cssText = 'display:inline-flex;gap:4px;margin-left:4px';
  TEXT_COLORS.forEach((c) => {
    const s = document.createElement('button');
    s.type = 'button'; s.title = c.name;
    s.style.cssText = 'width:18px;height:18px;min-width:18px;padding:0;border-radius:999px;border:1px solid var(--line-2);font-size:11px;color:var(--ink-soft);background:' + (c.value || 'transparent');
    if (!c.value) s.textContent = '×';
    s.addEventListener('mousedown', (e) => e.preventDefault());
    s.addEventListener('click', (e) => { e.preventDefault(); setColor(c.value); row.remove(); });
    row.appendChild(s);
  });
  ctxbar.appendChild(row);
  repositionCtx();
}

const FOCALS = [['Centro', '50% 50%'], ['Alto', '50% 0%'], ['Basso', '50% 100%'], ['Sx', '0% 50%'], ['Dx', '100% 50%']];
const SIZES = [['Piccola', '40%'], ['Media', '65%'], ['Grande', '85%'], ['Intera', '100%'], ['Sito intero', 'full']];
function setFocal(pos) {
  if (!selectedEl) return;
  if (selectedEl.tagName === 'IMG') selectedEl.style.objectPosition = pos;
  else selectedEl.style.backgroundPosition = pos;
  savePage();
}
function setSize(w) {
  if (!selectedEl || selectedEl.tagName !== 'IMG') return;
  if (w === 'full') {
    // Larghezza piena del sito: esce dal contenitore con il trucco dei margini negativi.
    selectedEl.style.width = '100vw';
    selectedEl.style.maxWidth = '100vw';
    selectedEl.style.height = 'auto';
    selectedEl.style.marginLeft = 'calc(50% - 50vw)';
    selectedEl.style.marginRight = 'calc(50% - 50vw)';
  } else {
    selectedEl.style.width = w;
    selectedEl.style.height = 'auto';
    selectedEl.style.maxWidth = '100%';
    selectedEl.style.marginLeft = w === '100%' ? '' : 'auto';
    selectedEl.style.marginRight = w === '100%' ? '' : 'auto';
  }
  savePage();
}
function currentFit() {
  const cs = getComputedStyle(selectedEl);
  return selectedEl.tagName === 'IMG' ? (cs.objectFit || '') : (cs.backgroundSize || '');
}
function setFitLabel(btn) { btn.textContent = currentFit().indexOf('contain') !== -1 ? 'Intera' : 'Riempi'; }
function toggleFit(btn) {
  if (!selectedEl) return;
  const toContain = currentFit().indexOf('contain') === -1;
  if (selectedEl.tagName === 'IMG') selectedEl.style.objectFit = toContain ? 'contain' : 'cover';
  else selectedEl.style.backgroundSize = toContain ? 'contain' : 'cover';
  setFitLabel(btn);
  savePage();
}
function presetRow(cls, presets, onPick) {
  const open = ctxbar.querySelector('.' + cls);
  ctxbar.querySelectorAll('.preset-row').forEach((r) => r.remove());
  if (open) { repositionCtx(); return; }
  const row = document.createElement('span');
  row.className = 'preset-row ' + cls;
  row.style.cssText = 'display:inline-flex;gap:4px;margin-left:4px';
  presets.forEach(([label, val]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'height:26px;padding:0 8px;border-radius:7px;border:0;background:var(--panel-2);color:var(--ink-soft);font:inherit;font-size:12px;cursor:pointer';
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => { e.preventDefault(); onPick(val); row.remove(); repositionCtx(); });
    row.appendChild(b);
  });
  ctxbar.appendChild(row);
  repositionCtx();
}

function photoControls(isImg) {
  ctxbar.innerHTML = '';
  ctxbar.appendChild(ctxButton('Cambia foto', 'Sostituisci immagine', () => {
    if (isImg) openImagePanel((src) => { selectedEl.src = src; selectedEl.removeAttribute('srcset'); }, selectedEl.alt || '');
    else openImagePanel((src) => { selectedEl.style.backgroundImage = "url('" + src + "')"; selectedEl.style.backgroundSize = 'cover'; selectedEl.style.backgroundPosition = 'center'; }, '');
  }));
  ctxbar.appendChild(ctxButton('Inquadratura', 'Posizione della foto', () => presetRow('focal-row', FOCALS, setFocal)));
  if (isImg) ctxbar.appendChild(ctxButton('Dimensione', 'Quanto e grande la foto', () => presetRow('size-row', SIZES, setSize)));
  const fitBtn = ctxButton('Riempi', 'Come la foto riempie lo spazio', () => toggleFit(fitBtn));
  setFitLabel(fitBtn);
  ctxbar.appendChild(fitBtn);
  if (isImg) {
    const s = document.createElement('span'); s.className = 'sep'; ctxbar.appendChild(s);
    ctxbar.appendChild(ctxButton(ICON.trash, 'Elimina', () => deleteEl(), 'danger'));
  }
  const sd = document.createElement('span'); sd.className = 'sep'; ctxbar.appendChild(sd);
  ctxbar.appendChild(ctxButton(ICON.check + '<span>Fatto</span>', 'Fine modifica', () => commitEdit(), 'done'));
}

function selectText(el) {
  hideCtx();
  selectedEl = el;
  el.setAttribute('contenteditable', 'true');
  el.focus();
  const doc = frameDoc(), w = frameWin();
  if (doc && w) {
    const range = doc.createRange(); range.selectNodeContents(el);
    const sel = w.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }
  ctxbar.innerHTML = '';
  ctxbar.appendChild(ctxButton(ICON.alignLeft, 'Allinea a sinistra', () => setAlign('left')));
  ctxbar.appendChild(ctxButton(ICON.alignCenter, 'Centra', () => setAlign('center')));
  ctxbar.appendChild(ctxButton(ICON.alignRight, 'Allinea a destra', () => setAlign('right')));
  const s1 = document.createElement('span'); s1.className = 'sep'; ctxbar.appendChild(s1);
  ctxbar.appendChild(ctxButton('<span class="cdot"></span>', 'Colore testo', () => toggleColorRow()));
  ctxbar.appendChild(ctxButton('<b>B</b>', 'Grassetto', () => toggleBold()));
  const s2 = document.createElement('span'); s2.className = 'sep'; ctxbar.appendChild(s2);
  ctxbar.appendChild(ctxButton(ICON.trash, 'Elimina', () => deleteEl(), 'danger'));
  const sd = document.createElement('span'); sd.className = 'sep'; ctxbar.appendChild(sd);
  ctxbar.appendChild(ctxButton(ICON.check + '<span>Fatto</span>', 'Conferma modifica', () => commitEdit(), 'done'));
  ctxbar.hidden = false;
  repositionCtx = () => positionCtx(el, ctxbar);
  repositionCtx();
}

function selectImage(img, x, y) {
  hideCtx();
  selectedEl = img;
  img.setAttribute('data-brik-sel', '');
  photoControls(true);
  ctxbar.hidden = false;
  repositionCtx = () => positionCtxNear(x, y);
  repositionCtx();
}

function openImagePanel(apply, initialQuery) {
  imgpanel.innerHTML =
    '<div class="row"><input type="text" id="imgq" placeholder="Cerca una foto (es. forno a legna)…"><button type="button" class="btn accent" id="imgsearch">Cerca</button></div>' +
    '<div class="grid-imgs" id="imggrid"></div><p class="hint" id="imghint">Scrivi cosa cercare e premi Cerca.</p>';
  imgpanel.hidden = false;
  imgpanel.style.left = '50%'; imgpanel.style.top = '16px'; imgpanel.style.transform = 'translateX(-50%)';
  const q = imgpanel.querySelector('#imgq');
  const grid = imgpanel.querySelector('#imggrid');
  const hint = imgpanel.querySelector('#imghint');
  const run = async () => {
    const term = q.value.trim();
    if (!term) return;
    hint.textContent = 'Cerco…'; grid.innerHTML = '';
    const data = await api('GET', '/api/images?q=' + encodeURIComponent(term));
    if (!data.ok || !data.images || !data.images.length) {
      hint.textContent = data.configured === false ? 'Ricerca foto non attiva (manca la chiave Pexels nel .env).' : 'Nessun risultato, prova altre parole.';
      return;
    }
    hint.textContent = 'Clicca una foto per inserirla.';
    data.images.forEach((im) => {
      const t = document.createElement('img');
      t.src = im.thumb || im.src; t.alt = im.alt || '';
      t.addEventListener('click', () => { apply(im.src); imgpanel.hidden = true; savePage(); hideCtx(); });
      grid.appendChild(t);
    });
  };
  imgpanel.querySelector('#imgsearch').addEventListener('click', run);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  if (initialQuery) q.value = initialQuery;
  q.focus();
}

function bgImageEl(node) {
  let el = node;
  for (let i = 0; i < 6 && el && el.nodeType === 1; i++) {
    if (el.tagName === 'BODY' || el.tagName === 'HTML') break;
    const bg = getComputedStyle(el).backgroundImage || '';
    if (bg.indexOf('url(') !== -1) return el;
    el = el.parentElement;
  }
  return null;
}

function selectBgImage(el, x, y) {
  hideCtx();
  selectedEl = el;
  el.setAttribute('data-brik-sel', '');
  photoControls(false);
  ctxbar.hidden = false;
  repositionCtx = () => positionCtxNear(x, y);
  repositionCtx();
}

function onFrameClick(e) {
  if (!editMode) return;
  const t = e.target;
  if (t.closest && t.closest('[data-brik-ui]')) return; // controlli sezione: lascia passare al loro handler
  if (t.closest && t.closest('[contenteditable="true"]')) return;
  const img = t.closest && t.closest('img');
  if (img) { e.preventDefault(); e.stopPropagation(); selectImage(img, e.clientX, e.clientY); return; }
  const el = t.closest ? t.closest(TEXT_SELECTOR) : null;
  if (el && !el.querySelector(TEXT_SELECTOR)) { e.preventDefault(); e.stopPropagation(); if (onMobile()) openTextSheet(el); else selectText(el); return; }
  const bg = bgImageEl(t);
  if (bg) { e.preventDefault(); e.stopPropagation(); selectBgImage(bg, e.clientX, e.clientY); return; }
  const host = el || (hasOwnText(t) ? t : null);
  if (host) { e.preventDefault(); e.stopPropagation(); hintAskbar(host); return; }
  hideCtx();
}

function onFrameKeydown(e) {
  if (!editMode) return;
  const el = e.target.closest ? e.target.closest('[contenteditable="true"]') : null;
  if (!el) return;
  if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') { e.preventDefault(); el.blur(); }
}

function onFrameBlur(e) {
  const el = e.target;
  if (el && el.getAttribute && el.getAttribute('contenteditable') === 'true') {
    el.removeAttribute('contenteditable');
    savePage();
  }
}

function onFrameScroll() { if (selectedEl && ctxbar && !ctxbar.hidden) repositionCtx(); }

function tagBgImages(doc) {
  if (!doc.body) return;
  doc.body.querySelectorAll('*').forEach((el) => {
    const bg = getComputedStyle(el).backgroundImage || '';
    if (bg.indexOf('url(') !== -1) el.setAttribute('data-brik-bg', '');
    else el.removeAttribute('data-brik-bg');
  });
}

function attachEdit() {
  const doc = frameDoc();
  if (!doc) return;
  doc.documentElement.classList.add('brik-editing');
  if (!doc.getElementById('brik-edit-style')) {
    const st = doc.createElement('style'); st.id = 'brik-edit-style'; st.textContent = EDIT_STYLE;
    doc.head.appendChild(st);
  }
  tagBgImages(doc);
  doc.addEventListener('click', onFrameClick, true);
  doc.addEventListener('keydown', onFrameKeydown, true);
  doc.addEventListener('blur', onFrameBlur, true);
  const w = frameWin(); if (w) w.addEventListener('scroll', onFrameScroll, true);
  attachSectionControls(doc);
}

function detachEdit() {
  hideCtx();
  const doc = frameDoc();
  if (!doc) return;
  removeSectionControls(doc);
  doc.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'));
  doc.querySelectorAll('[data-brik-sel]').forEach((e) => e.removeAttribute('data-brik-sel'));
  doc.querySelectorAll('[data-brik-bg]').forEach((e) => e.removeAttribute('data-brik-bg'));
  doc.documentElement.classList.remove('brik-editing');
  const st = doc.getElementById('brik-edit-style'); if (st) st.remove();
  doc.removeEventListener('click', onFrameClick, true);
  doc.removeEventListener('keydown', onFrameKeydown, true);
  doc.removeEventListener('blur', onFrameBlur, true);
  const w = frameWin(); if (w) w.removeEventListener('scroll', onFrameScroll, true);
}

// --- Sezioni: sposta/elimina in modalità modifica (deterministico, salva via savePage) ---
function sectionContainerOf(doc) {
  const first = doc.querySelector('main > section, body > section, section');
  if (!first) return null;
  return first.parentElement || doc.body;
}
function sectionBlocks(doc) {
  const c = sectionContainerOf(doc);
  if (!c) return [];
  return Array.from(c.children).filter((el) => el.tagName === 'SECTION');
}
function removeSectionControls(doc) { try { doc.querySelectorAll('[data-brik-ui]').forEach((e) => e.remove()); } catch (e) {} }
function attachSectionControls(doc) {
  if (!doc) return;
  removeSectionControls(doc);
  const blocks = sectionBlocks(doc);
  const view = doc.defaultView || window;
  blocks.forEach((sec, i) => {
    try { if (view.getComputedStyle(sec).position === 'static') sec.style.position = 'relative'; } catch (e) {}
    const bar = doc.createElement('div');
    bar.setAttribute('data-brik-ui', 'sec');
    bar.style.cssText = 'position:absolute;top:8px;right:8px;z-index:2147483600;display:flex;gap:4px;background:rgba(20,20,24,.92);padding:4px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.35);';
    const mk = (label, title, fn, disabled) => {
      const b = doc.createElement('button');
      b.type = 'button'; b.textContent = label; b.title = title;
      b.style.cssText = 'border:0;border-radius:6px;width:30px;height:30px;font-size:15px;line-height:1;cursor:' + (disabled ? 'default' : 'pointer') + ';background:' + (disabled ? '#3a3a44' : '#fff') + ';color:' + (disabled ? '#777' : '#111') + ';';
      if (disabled) b.disabled = true; else if (fn) b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, true);
      return b;
    };
    bar.appendChild(mk('↑', 'Sposta su', () => moveSection(sec, -1), i === 0));
    bar.appendChild(mk('↓', 'Sposta giù', () => moveSection(sec, 1), i === blocks.length - 1));
    // Cestino: conferma a due tocchi (l'iframe sandbox blocca confirm()).
    const del = mk('🗑', 'Elimina sezione', null);
    let armed = false, armTimer = null;
    del.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!armed) {
        armed = true; del.textContent = 'OK?'; del.style.background = '#e23b3b'; del.style.color = '#fff';
        armTimer = setTimeout(() => { armed = false; del.textContent = '🗑'; del.style.background = '#fff'; del.style.color = '#111'; }, 2500);
        return;
      }
      clearTimeout(armTimer); deleteSection(sec);
    }, true);
    bar.appendChild(del);
    sec.appendChild(bar);
  });
}
async function savePageThenReattach() {
  await savePage();
  const doc = frameDoc();
  if (doc && editMode) attachSectionControls(doc);
}
function moveSection(sec, dir) {
  const c = sec.parentElement; if (!c) return;
  const sibs = Array.from(c.children).filter((el) => el.tagName === 'SECTION');
  const idx = sibs.indexOf(sec);
  const target = sibs[idx + dir];
  if (!target) return;
  removeSectionControls(frameDoc());
  if (dir < 0) c.insertBefore(sec, target); else c.insertBefore(target, sec);
  savePageThenReattach();
}
function deleteSection(sec) {
  // Niente confirm(): l'iframe è in sandbox senza allow-modals, quindi confirm verrebbe bloccato.
  // L'eliminazione è recuperabile con "Annulla ultima".
  removeSectionControls(frameDoc());
  sec.remove();
  savePageThenReattach();
}

// --- Aggiunta sezioni: template deterministici che usano le classi del design system (ereditano il tema). ---
// Immagine segnaposto grigia: l'utente la sostituisce col tap-su-foto già esistente.
const PH_IMG = "data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600'%3E%3Crect width='100%25' height='100%25' fill='%23d9d9d9'/%3E%3C/svg%3E";
function ytEmbed(url) {
  url = (url || '').trim();
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return 'https://www.youtube.com/embed/' + yt[1];
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return 'https://player.vimeo.com/video/' + vm[1];
  return url; // fallback: usa l'URL così com'è
}
const SECTION_TYPES = [
  { key: 'map', label: 'Mappa', emoji: '📍', fields: [{ name: 'address', label: 'Indirizzo', placeholder: 'Via Roma 1, Milano' }],
    build: (v) => `<section class="section"><div class="container"><h2>Dove siamo</h2><p class="lead">${escapeHtml(v.address || '')}</p><div class="brik-map"><iframe src="https://www.google.com/maps?q=${encodeURIComponent(v.address || '')}&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Mappa"></iframe></div></div></section>` },
  { key: 'image', label: 'Immagine', emoji: '🖼️', fields: [],
    build: () => `<section class="section"><div class="container"><figure class="brik-image"><img src="${PH_IMG}" alt="Immagine"><figcaption class="cap">Didascalia</figcaption></figure></div></section>` },
  { key: 'gallery', label: 'Galleria', emoji: '🗂️', fields: [],
    build: () => `<section class="section"><div class="container"><h2>Galleria</h2><div class="brik-gallery">${[0, 0, 0, 0].map(() => `<img src="${PH_IMG}" alt="Foto">`).join('')}</div></div></section>` },
  { key: 'video', label: 'Video', emoji: '🎬', fields: [{ name: 'url', label: 'Link YouTube o Vimeo', placeholder: 'https://youtu.be/…' }],
    build: (v) => `<section class="section"><div class="container"><h2>Video</h2><div class="brik-embed"><iframe src="${escapeHtml(ytEmbed(v.url))}" loading="lazy" allowfullscreen title="Video"></iframe></div></div></section>` },
  { key: 'form', label: 'Form contatti', emoji: '✉️', fields: [],
    build: () => `<section class="section"><div class="container"><h2>Contattaci</h2><form class="brik-form" data-brik-form action="${location.origin}/api/contact" method="post"><input type="hidden" name="pid" value="${escapeHtml(currentId || '')}"><label class="brik-hp">Non compilare<input type="checkbox" name="botcheck" tabindex="-1" autocomplete="off"></label><input type="text" name="name" placeholder="Nome" required><input type="email" name="email" placeholder="Email" required><textarea name="message" rows="4" placeholder="Messaggio"></textarea><button class="btn primary" type="submit">Invia</button><p data-brik-form-msg style="opacity:.8;margin:0"></p></form></div></section>` },
  { key: 'hours', label: 'Orari', emoji: '🕒', fields: [],
    build: () => `<section class="section"><div class="container"><h2>Orari</h2><div class="brik-hours">${['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'].map((d) => `<div class="row"><span>${d}</span><span>09:00 – 18:00</span></div>`).join('')}</div></div></section>` },
  { key: 'cta', label: 'Bottone / CTA', emoji: '🔘', fields: [{ name: 'title', label: 'Titolo', placeholder: 'Pronto a iniziare?' }, { name: 'button', label: 'Testo bottone', placeholder: 'Contattaci' }, { name: 'link', label: 'Link (URL, tel:, mailto:, WhatsApp)', placeholder: 'tel:+39…' }],
    build: (v) => `<section class="section"><div class="container" style="text-align:center"><h2>${escapeHtml(v.title || 'Pronto a iniziare?')}</h2><p style="margin-top:1.6rem"><a class="btn primary" href="${escapeHtml(v.link || '#')}">${escapeHtml(v.button || 'Contattaci')}</a></p></div></section>` },
  { key: 'faq', label: 'FAQ', emoji: '❓', fields: [],
    build: () => `<section class="section"><div class="container"><h2>Domande frequenti</h2><div class="brik-faq">${[['Domanda 1?', 'Risposta alla prima domanda.'], ['Domanda 2?', 'Risposta alla seconda domanda.'], ['Domanda 3?', 'Risposta alla terza domanda.']].map(([q, a]) => `<details><summary>${q}</summary><p class="a">${a}</p></details>`).join('')}</div></div></section>` },
  { key: 'price', label: 'Listino / Menu', emoji: '💶', fields: [],
    build: () => `<section class="section"><div class="container"><h2>Listino</h2><div class="brik-pricelist">${[['Voce 1', '€ 00'], ['Voce 2', '€ 00'], ['Voce 3', '€ 00']].map(([n, p]) => `<div class="row"><span>${n}</span><span class="price">${p}</span></div>`).join('')}</div></div></section>` },
  { key: 'reviews', label: 'Recensioni', emoji: '⭐', fields: [],
    build: () => `<section class="section"><div class="container"><h2>Recensioni</h2>${[['«Servizio eccellente, lo consiglio a tutti.»', '— Cliente'], ['«Professionali e puntuali.»', '— Cliente']].map(([q, a]) => `<blockquote style="margin:1.4rem 0;max-width:46ch"><p class="lead">${q}</p><cite style="opacity:.7">${a}</cite></blockquote>`).join('')}</div></section>` },
  { key: 'social', label: 'Social', emoji: '📱', fields: [{ name: 'instagram', label: 'Instagram (URL)', placeholder: 'https://instagram.com/…' }, { name: 'facebook', label: 'Facebook (URL)', placeholder: 'https://facebook.com/…' }, { name: 'tiktok', label: 'TikTok (URL)', placeholder: 'https://tiktok.com/@…' }],
    build: (v) => { const L = []; if (v.instagram) L.push(`<a href="${escapeHtml(v.instagram)}" target="_blank" rel="noopener">Instagram</a>`); if (v.facebook) L.push(`<a href="${escapeHtml(v.facebook)}" target="_blank" rel="noopener">Facebook</a>`); if (v.tiktok) L.push(`<a href="${escapeHtml(v.tiktok)}" target="_blank" rel="noopener">TikTok</a>`); if (!L.length) L.push('<a href="#">Instagram</a>'); return `<section class="section"><div class="container"><h2>Seguici</h2><div class="brik-social">${L.join('')}</div></div></section>`; } },
  { key: 'team', label: 'Team', emoji: '👥', fields: [],
    build: () => `<section class="section"><div class="container"><h2>Il team</h2><div class="brik-team">${[0, 0, 0].map(() => `<div class="m"><img src="${PH_IMG}" alt="Persona"><strong>Nome Cognome</strong><div style="opacity:.7">Ruolo</div></div>`).join('')}</div></div></section>` },
  { key: 'text', label: 'Testo', emoji: '📝', fields: [],
    build: () => `<section class="section"><div class="container"><h2>Titolo sezione</h2><p class="prose">Scrivi qui il testo della sezione. Tocca per modificarlo.</p></div></section>` },
];
function openSectionPicker() {
  if (!frameDoc()) { alert('Apri un sito prima di aggiungere sezioni.'); return; }
  const old = document.getElementById('secPickOverlay'); if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'secPickOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10002;display:flex;align-items:flex-end;justify-content:center;';
  ov.innerHTML = '<div style="background:#0b0d14;color:#eef1f7;width:100%;max-width:560px;border-radius:16px 16px 0 0;padding:18px 18px 26px;max-height:82vh;overflow:auto;box-shadow:0 -10px 40px rgba(0,0,0,.5);border-top:1px solid #1b2130;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;"><strong style="font-size:17px;">Aggiungi sezione</strong><button id="secPickClose" type="button" style="border:0;background:#1a1f2b;color:#cfd6e4;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:15px;">✕</button></div><div id="secPickBody"></div></div>';
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('#secPickClose').onclick = close;
  renderTypeGrid(ov.querySelector('#secPickBody'), close);
}
function renderTypeGrid(body, close) {
  body.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:8px;">' +
    SECTION_TYPES.map((t, i) => `<button data-sti="${i}" type="button" style="display:flex;flex-direction:column;align-items:center;gap:8px;border:1px solid #1b2130;border-radius:14px;padding:14px 8px 12px;cursor:pointer;background:#04060e;font-size:12.5px;color:#cfd6e4;"><img src="/assets/sections/${t.key}.png" alt="" width="46" height="46" style="display:block;"/>${t.label}</button>`).join('') + '</div>';
  body.querySelectorAll('[data-sti]').forEach((b) => {
    b.onclick = () => {
      const t = SECTION_TYPES[Number(b.getAttribute('data-sti'))];
      if (t.fields && t.fields.length) renderTypeForm(body, t, close);
      else { insertSection(t.build({})); close(); }
    };
  });
}
function renderTypeForm(body, t, close) {
  body.innerHTML = '<button id="secBack" type="button" style="border:0;background:none;color:#7c8cff;cursor:pointer;font-size:13px;margin-bottom:8px;">‹ Indietro</button>' +
    `<div style="display:flex;align-items:center;gap:9px;font-weight:600;margin-bottom:10px;color:#eef1f7;"><img src="/assets/sections/${t.key}.png" alt="" width="32" height="32" style="display:block;"/>${t.label}</div>` +
    t.fields.map((f) => `<label style="display:block;font-size:13px;color:#98a1b4;margin:8px 0 3px;">${f.label}</label><input data-fld="${f.name}" type="${f.type || 'text'}" placeholder="${f.placeholder || ''}" style="width:100%;box-sizing:border-box;border:1px solid #262b39;border-radius:8px;padding:9px 11px;font-size:14px;background:#0f121a;color:#eef1f7;">`).join('') +
    '<button id="secAdd" type="button" style="margin-top:14px;width:100%;border:0;border-radius:10px;padding:11px;background:#5b8cff;color:#fff;font-weight:600;font-size:14px;cursor:pointer;">Aggiungi</button>';
  body.querySelector('#secBack').onclick = () => renderTypeGrid(body, close);
  body.querySelector('#secAdd').onclick = () => {
    const v = {};
    body.querySelectorAll('[data-fld]').forEach((i) => { v[i.getAttribute('data-fld')] = i.value.trim(); });
    insertSection(t.build(v));
    close();
  };
}
function insertSection(html) {
  const doc = frameDoc(); if (!doc) return;
  const tmp = doc.createElement('div');
  tmp.innerHTML = (html || '').trim();
  const node = tmp.firstElementChild; if (!node) return;
  const container = sectionContainerOf(doc) || doc.body;
  // Default: inserisci PRIMA del footer; poi l'utente sposta con le frecce.
  let footer = null;
  try { footer = doc.querySelector('footer, .footer, .site-footer'); } catch (e) {}
  if (footer && footer.parentElement) footer.parentElement.insertBefore(node, footer);
  else container.appendChild(node);
  savePageThenReattach();
  try { node.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
}

function serializeForSave() {
  const doc = frameDoc();
  if (!doc) return null;
  try {
    const clone = doc.documentElement.cloneNode(true);
    clone.querySelectorAll('[data-brik-ui]').forEach((e) => e.remove());
    clone.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'));
    clone.querySelectorAll('[data-brik-sel]').forEach((e) => e.removeAttribute('data-brik-sel'));
    clone.querySelectorAll('[data-brik-bg]').forEach((e) => e.removeAttribute('data-brik-bg'));
    clone.classList.remove('brik-editing');
    const st = clone.querySelector('#brik-edit-style'); if (st) st.remove();
    return '<!doctype html>\n' + clone.outerHTML;
  } catch (e) {
    let html = '<!doctype html>\n' + doc.documentElement.outerHTML;
    html = html.replace(/<style id="brik-edit-style">[\s\S]*?<\/style>/i, '');
    html = html.replace(/ class="brik-editing"/, '');
    html = html.replace(/\s*contenteditable="[^"]*"/gi, '');
    html = html.replace(/\s*data-brik-sel(?:="[^"]*")?/gi, '');
    html = html.replace(/\s*data-brik-bg(?:="[^"]*")?/gi, '');
    return html;
  }
}

function reflectState(data) {
  currentStatus = data.state.status;
  renderGating(data.state);
}

async function savePage() {
  if (!currentId) return;
  const html = serializeForSave();
  if (!html) return;
  const route = routeFromFrame();
  const data = await api('POST', `/api/projects/${encodeURIComponent(currentId)}/page`, { route, html });
  if (data.ok) { reflectState(data); refreshProjects(currentId); }
  else addMsg('bot', `<p class="tiny">Modifica non salvata: ${escapeHtml(data.error?.message || '')}</p>`, 'err');
}

async function applyTheme(theme, accent) {
  if (!currentId) return;
  const body = {};
  if (theme) body.theme = theme;
  if (accent !== undefined) body.accent = accent || '';
  const data = await api('POST', `/api/projects/${encodeURIComponent(currentId)}/theme`, body);
  if (!data.ok) { addMsg('bot', `<p class="tiny">${escapeHtml(data.error?.message || 'errore')}</p>`, 'err'); return; }
  if (data.theme) { currentTheme = data.theme; if (themeSelect) themeSelect.value = data.theme; }
  reflectState(data);
  navPreview(currentId, currentRoute, data.state.version);
  refreshProjects(currentId);
}

function markActiveSwatch() {
  if (!accentSwatches) return;
  accentSwatches.querySelectorAll('button').forEach((b) =>
    b.classList.toggle('active', (currentAccent || '').toLowerCase() === (b.dataset.hex || '').toLowerCase()),
  );
}

function buildSwatches() {
  if (swatchesBuilt || !accentSwatches) return;
  swatchesBuilt = true;
  ACCENTS.forEach((hex) => {
    const b = document.createElement('button');
    b.type = 'button'; b.style.background = hex; b.dataset.hex = hex; b.title = hex;
    b.addEventListener('click', () => { currentAccent = hex; if (accentColor) accentColor.value = hex; markActiveSwatch(); applyTheme(null, hex); });
    accentSwatches.appendChild(b);
  });
}

function setEditMode(on) {
  editMode = on;
  if (editBtn) editBtn.classList.toggle('active', on);
  if (askbar) { askbar.hidden = !on; if (on) askbar.classList.remove('open'); } // entra sempre chiusa (piccola)
  if (on) attachEdit();
  else detachEdit();
  updateModeButtons();
}

// Campo "Chiedi una modifica" (in modalità Modifica): stesso flusso /edit della chat.
function autoGrowAsk() {
  if (!askInput) return;
  askInput.style.height = 'auto';
  askInput.style.height = Math.min(askInput.scrollHeight, 140) + 'px';
}
function submitAsk() {
  if (!currentId || !askInput) return;
  const v = (askInput.value || '').trim();
  if (!v) { askInput.focus(); return; }
  askInput.value = '';
  autoGrowAsk();
  editSite(v);
}
if (askForm) askForm.addEventListener('submit', (e) => { e.preventDefault(); submitAsk(); });
if (askInput) {
  askInput.addEventListener('input', autoGrowAsk);
  askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAsk(); } });
}

function currentSubdomain() {
  const m = (currentUrl || '').match(/https:\/\/([a-z0-9-]+)\.pages\.dev/i);
  return m ? m[1] : '';
}
function refreshAddrNote() {
  if (!addrNote) return;
  const v = subSanitize(ownerAddrInput.value) || 'sito';
  addrNote.textContent = 'Nuovo indirizzo: ' + v + '.pages.dev';
}
// --- Estensione "Privacy e cookie" nei Settings (iniettata nel DOM esistente) ---
function ensureLegalExtras() {
  if (!settingsSave || document.getElementById('legalExtra')) return;
  const chk = (attr, k, label) => '<label class="legal-chk"><input type="checkbox" ' + attr + '="' + k + '"> ' + label + '</label>';
  // Servizi che Brik non inietta ancora nei siti: checkbox disabilitato, mai salvato come attivo.
  const chkOff = (label) => '<label class="legal-chk" style="opacity:.55" title="Brik non inserisce ancora questo strumento nei siti pubblicati: non verrà dichiarato nelle policy."><input type="checkbox" disabled> ' + label + ' <span style="font-size:.82em;color:#9aa0aa">· non ancora supportato</span></label>';
  const wrap = document.createElement('div');
  wrap.id = 'legalExtra';
  wrap.innerHTML =
    '<hr class="legal-sep">' +
    '<div class="legal-h">Privacy e cookie</div>' +
    '<div class="legal-sub">Compila solo ciò che usi: serve a generare una privacy/cookie policy base più precisa. Lascia vuoto ciò che non sai.</div>' +
    '<label class="legal-field"><span>Email privacy</span><input id="legalPrivacyEmail" type="email" placeholder="privacy@tuosito.it"></label>' +
    '<label class="legal-field"><span>Telefono</span><input id="legalPhone" type="tel" placeholder="+39 ..."></label>' +
    '<div class="legal-grp"><div class="legal-grp-t">Dati raccolti dal sito</div>' +
      chk('data-lc', 'name', 'Nome') + chk('data-lc', 'email', 'Email') + chk('data-lc', 'phone', 'Telefono') +
      chk('data-lc', 'message', 'Messaggio') + chk('data-lc', 'reservationPreference', 'Preferenze prenotazione') + '</div>' +
    '<div class="legal-grp"><div class="legal-grp-t">Finalità del trattamento</div>' +
      chk('data-lp', 'contactRequests', 'Richieste di contatto') + chk('data-lp', 'reservations', 'Prenotazioni') +
      chk('data-lp', 'whatsapp', 'Contatto WhatsApp') + chk('data-lp', 'newsletter', 'Newsletter') +
      chk('data-lp', 'analytics', 'Statistiche') + chk('data-lp', 'marketing', 'Marketing') + '</div>' +
    '<div class="legal-grp"><div class="legal-grp-t">Servizi usati</div>' +
      chk('data-lt', 'googleMaps', 'Google Maps') + chk('data-lt', 'youtubeVimeo', 'Video YouTube') +
      chk('data-lt', 'instagramFacebookLinks', 'Link Instagram/Facebook') +
      chkOff('Meta Pixel') + chkOff('Google Ads') + chkOff('Strumenti di analisi') + '</div>' +
    '<p class="legal-note">Brik può aiutarti a preparare una privacy/cookie policy base con i dati che inserisci. Per esigenze specifiche o attività complesse, verifica sempre con un consulente.</p>' +
    '<div id="legalWarnings"></div>';
  settingsSave.parentNode.insertBefore(wrap, settingsSave);
  if (!document.getElementById('legalExtraCss')) {
    const st = document.createElement('style');
    st.id = 'legalExtraCss';
    st.textContent =
      '#legalExtra .legal-sep{border:0;border-top:1px solid rgba(127,127,127,.18);margin:18px 0 12px}' +
      '#legalExtra .legal-h{font-weight:600;margin-bottom:4px}' +
      '#legalExtra .legal-sub{font-size:.8rem;opacity:.65;margin-bottom:10px}' +
      '#legalExtra .legal-field{display:block;margin:8px 0}' +
      '#legalExtra .legal-field span{display:block;font-size:.82rem;opacity:.8;margin-bottom:3px}' +
      '#legalExtra .legal-field input,#legalExtra .legal-field select{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit}' +
      '#legalExtra .legal-grp{margin:10px 0}' +
      '#legalExtra .legal-grp-t{font-size:.8rem;opacity:.8;margin-bottom:4px}' +
      '#legalExtra .legal-chk{display:inline-flex;align-items:center;gap:5px;font-size:.82rem;margin:2px 12px 2px 0;cursor:pointer}' +
      '#legalExtra .legal-note{font-size:.78rem;opacity:.7;margin:12px 0 0;line-height:1.5}' +
      '#legalWarnings{margin-top:10px}';
    document.head.appendChild(st);
  }
}

function fillLegalExtras() {
  const L = currentLegal || {};
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v || ''; };
  set('legalPrivacyEmail', L.privacyEmail);
  set('legalPhone', L.phone);
  document.querySelectorAll('[data-lc]').forEach((e) => { e.checked = !!(L.collectedData && L.collectedData[e.getAttribute('data-lc')]); });
  document.querySelectorAll('[data-lp]').forEach((e) => { e.checked = !!(L.purposes && L.purposes[e.getAttribute('data-lp')]); });
  document.querySelectorAll('[data-lt]').forEach((e) => { e.checked = !!(L.thirdPartyServices && L.thirdPartyServices[e.getAttribute('data-lt')]); });
  const w = document.getElementById('legalWarnings'); if (w) w.innerHTML = '';
}

// Pop-up bloccante per i warning: l'utente DEVE scegliere "continuo comunque" o "correggi".
// Generico: riusabile per ogni warning dell'app (non solo legale).
function showBlockingWarnings(warnings, opts) {
  opts = opts || {};
  const items = (warnings || []).filter(Boolean).map((w) => '<li>' + escapeHtml(String(w)) + '</li>').join('');
  const ov = document.createElement('div');
  ov.className = 'modal';
  ov.innerHTML =
    '<div class="modal-card compact">' +
    '<div class="modal-head"><h3>' + escapeHtml(opts.title || 'Controlla prima di continuare') + '</h3></div>' +
    '<p class="set-note" style="margin:0 0 10px">' + escapeHtml(opts.intro || 'Ci sono alcuni punti da sistemare. Puoi correggerli ora oppure proseguire comunque.') + '</p>' +
    '<ul style="margin:0 0 14px;padding-left:18px;font-size:.85rem;line-height:1.55">' + items + '</ul>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">' +
    '<button class="btn" data-act="fix">' + escapeHtml(opts.fixLabel || 'Torna a correggere') + '</button>' +
    '<button class="btn accent" data-act="continue">' + escapeHtml(opts.continueLabel || 'Ho letto e continuo comunque') + '</button>' +
    '</div></div>';
  document.body.appendChild(ov);
  const close = () => ov.remove();
  // Bloccante: nessuna chiusura passiva (no click sullo sfondo, no ×). Solo i due pulsanti.
  ov.querySelector('[data-act="fix"]').addEventListener('click', () => { close(); if (opts.onFix) opts.onFix(); });
  ov.querySelector('[data-act="continue"]').addEventListener('click', () => { close(); if (opts.onContinue) opts.onContinue(); });
  return ov;
}

function openSettings() {
  if (!currentId || !settings) return;
  buildSwatches();
  readThemeAccent();
  ensureLegalExtras();
  fillLegalExtras();
  if (ownerEmailInput) ownerEmailInput.value = currentEmail || '';
  if (legalNameInput) legalNameInput.value = (currentLegal && currentLegal.legalName) || '';
  if (legalVatInput) legalVatInput.value = (currentLegal && currentLegal.vat) || '';
  if (legalAddrInput) legalAddrInput.value = (currentLegal && currentLegal.address) || '';
  const sub = currentSubdomain();
  if (addrRow) {
    addrRow.hidden = !sub;
    if (sub && ownerAddrInput) { ownerAddrInput.value = sub; refreshAddrNote(); }
  }
  if (customDomainRow) customDomainRow.hidden = !sub;
  if (cdMsg) cdMsg.textContent = '';
  if (sub) loadCustomDomain(); else if (cdPanel) { cdPanel.hidden = true; cdPanel.innerHTML = ''; }
  if (settingsMsg) { settingsMsg.style.color = ''; settingsMsg.textContent = authUser ? '' : 'Per salvare email, dati legali e stile serve un account: accedi e queste informazioni restano sul tuo sito.'; }
  if (settingsSave) settingsSave.textContent = authUser ? 'Salva impostazioni' : 'Accedi per salvare';
  settings.hidden = false;
}
function closeSettings() { if (settings) settings.hidden = true; }

async function changeAddress() {
  if (!currentId) return;
  const next = subSanitize(ownerAddrInput.value);
  if (!next) { ownerAddrInput.focus(); return; }
  if (next === currentSubdomain()) { closeSettings(); return; }
  closeSettings();
  await doPublish(next);
}

async function saveEmail() {
  if (!currentId) return { ok: false };
  const em = (ownerEmailInput.value || '').trim();
  // Niente email e non ce n'era una: nulla da salvare → ok (così il modale si chiude lo stesso).
  if (!em && !currentEmail) return { ok: true };
  const data = await api('POST', `/api/projects/${encodeURIComponent(currentId)}/email`, { email: em });
  if (data.ok) { currentEmail = data.email || ''; return { ok: true }; }
  return { ok: false, error: data.error || { message: 'Salvataggio email non riuscito.' } };
}

async function saveLegal() {
  if (!currentId) return { ok: false };
  const gv = (id) => { const e = document.getElementById(id); return e ? (e.value || '').trim() : ''; };
  const flags = (attr) => { const o = {}; document.querySelectorAll('[' + attr + ']').forEach((e) => { if (e.checked) o[e.getAttribute(attr)] = true; }); return o; };
  const payload = {
    legalName: ((legalNameInput && legalNameInput.value) || '').trim(),
    vat: ((legalVatInput && legalVatInput.value) || '').trim(),
    address: ((legalAddrInput && legalAddrInput.value) || '').trim(),
    privacyEmail: gv('legalPrivacyEmail'),
    phone: gv('legalPhone'),
    collectedData: flags('data-lc'),
    purposes: flags('data-lp'),
    thirdPartyServices: flags('data-lt'),
  };
  const anyExtra = !!(payload.privacyEmail || payload.phone ||
    Object.keys(payload.collectedData).length || Object.keys(payload.purposes).length || Object.keys(payload.thirdPartyServices).length);
  const empty = !payload.legalName && !payload.vat && !payload.address && !anyExtra;
  const had = currentLegal && (currentLegal.legalName || currentLegal.vat || currentLegal.address || currentLegal.privacyEmail);
  if (empty && !had) return { ok: true, warnings: [] }; // niente da salvare → ok
  const data = await api('POST', `/api/projects/${encodeURIComponent(currentId)}/legal`, payload);
  if (data.ok) { currentLegal = data.legal || payload; return { ok: true, warnings: data.warnings || [] }; }
  return { ok: false, error: data.error || { message: 'Salvataggio dati legali non riuscito.' } };
}

async function saveAllSettings() {
  if (!currentId || !settingsSave) return;
  if (!authUser) { closeSettings(); promptAuth('Accedi per salvare le impostazioni del sito: email, dati legali e stile.'); return; }
  if (settingsMsg) { settingsMsg.style.color = ''; settingsMsg.textContent = ''; }
  settingsSave.disabled = true;
  settingsSave.textContent = 'Salvataggio…';
  let ok = false, err = null, r2 = null;
  try {
    const r1 = await saveEmail();
    r2 = await saveLegal();
    ok = r1.ok && r2.ok;
    if (!ok) err = (!r1.ok ? r1.error : r2.error) || { message: 'Salvataggio non riuscito.' };
  } catch (e) { err = { message: 'Errore di rete, riprova.' }; }
  if (ok) {
    const warns = (r2 && r2.warnings) || [];
    settingsSave.textContent = 'Salvato ✓';
    settingsSave.disabled = false;
    setTimeout(() => { settingsSave.textContent = 'Salva impostazioni'; }, 900);
    if (warns.length) {
      showBlockingWarnings(warns, {
        title: 'Dati legali da completare',
        intro: 'Le impostazioni sono salvate. Questi punti rendono però la privacy/cookie policy incompleta o da verificare:',
        continueLabel: 'Ho letto e continuo comunque',
        fixLabel: 'Torna a correggere',
        onContinue: () => closeSettings(),
        onFix: () => { const e = document.getElementById('legalExtra'); if (e && e.scrollIntoView) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
      });
      return;
    }
    closeSettings();
    return;
  }
  settingsSave.textContent = 'Salva impostazioni';
  settingsSave.disabled = false;
  if (err && err.code === 'NEEDS_AUTH') { closeSettings(); return; } // il login (aperto da api) ora è visibile
  if (settingsMsg) {
    settingsMsg.style.color = '#e08b7a';
    const raw = (err && (err.message || err.code)) || '';
    const human = /non trovat|not.?found|404/i.test(raw)
      ? 'Salvataggio non riuscito: il sito potrebbe essere in aggiornamento. Ricarica la pagina e riprova tra poco.'
      : ((err && err.message) || 'Salvataggio non riuscito.');
    settingsMsg.textContent = human;
  }
}

function _cdStatusLabel(status) {
  if (status === 'active') return { dot: '🟢', text: 'Dominio attivo.' };
  if (status === 'pending' || status === 'initializing' || status === 'pending_validation') return { dot: '🟡', text: 'In attesa: aggiungi il record qui sotto e attendi la propagazione (anche fino a ~1 ora), poi premi Verifica.' };
  return { dot: '🟡', text: 'In attesa di verifica. Se hai appena aggiunto il record, attendi qualche minuto e premi Verifica.' };
}
function renderDomainPanel(data) {
  if (!cdPanel) return;
  if (!data || !data.domain) { cdPanel.hidden = true; cdPanel.innerHTML = ''; if (cdInput) cdInput.value = ''; return; }
  const c = data.cname || {};
  const s = _cdStatusLabel(data.status);
  cdPanel.hidden = false;
  if (cdInput) cdInput.value = '';
  cdPanel.innerHTML =
    '<div style="font-size:13px;line-height:1.5">' +
    '<div style="margin-bottom:6px"><strong>' + escapeHtml(data.domain) + '</strong> — ' + s.dot + ' ' + escapeHtml(s.text) + '</div>' +
    '<div style="background:var(--panel-2,#f4f4f8);border-radius:8px;padding:8px 10px;margin:6px 0">' +
      'Aggiungi questo record dal pannello del tuo provider DNS:<br>' +
      '<span style="font-family:monospace;font-size:12.5px">Tipo <b>' + escapeHtml(c.type || 'CNAME') + '</b> · Nome <b>' + escapeHtml(c.name || 'www') + '</b> · Valore <b>' + escapeHtml(c.value || '') + '</b></span> ' +
      '<button type="button" class="btn ghost" data-cd="copy" data-val="' + escapeHtml(c.value || '') + '" style="padding:2px 8px;font-size:12px">Copia</button>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:6px">' +
      '<button type="button" class="btn ghost" data-cd="verify" style="padding:4px 10px;font-size:13px">Verifica</button>' +
      '<button type="button" class="btn ghost" data-cd="unlink" style="padding:4px 10px;font-size:13px;opacity:.6">Scollega</button>' +
    '</div></div>';
}
async function loadCustomDomain() {
  if (!currentId || !cdPanel) return;
  try { const d = await api('GET', '/api/projects/' + encodeURIComponent(currentId) + '/domain'); if (d && d.ok) renderDomainPanel(d); } catch (e) {}
}
async function linkCustomDomain() {
  if (!currentId || !cdInput) return;
  const domain = (cdInput.value || '').trim();
  if (!domain) { cdInput.focus(); return; }
  if (cdMsg) { cdMsg.style.color = ''; cdMsg.textContent = 'Collego…'; }
  const d = await api('POST', '/api/projects/' + encodeURIComponent(currentId) + '/domain', { domain });
  if (d && d.ok) { if (cdMsg) cdMsg.textContent = ''; renderDomainPanel(d); }
  else if (cdMsg) { cdMsg.style.color = 'var(--danger,#c0392b)'; cdMsg.textContent = (d && d.error && d.error.message) || 'Non riesco a collegare il dominio.'; }
}
async function verifyCustomDomain() {
  if (!currentId) return;
  if (cdMsg) { cdMsg.style.color = ''; cdMsg.textContent = 'Verifico…'; }
  const d = await api('GET', '/api/projects/' + encodeURIComponent(currentId) + '/domain');
  if (d && d.ok) { if (cdMsg) cdMsg.textContent = ''; renderDomainPanel(d); }
}
async function unlinkCustomDomain() {
  if (!currentId) return;
  const d = await api('DELETE', '/api/projects/' + encodeURIComponent(currentId) + '/domain');
  if (d && d.ok) { if (cdMsg) cdMsg.textContent = ''; renderDomainPanel({ domain: null }); }
}
if (cdLink) cdLink.addEventListener('click', linkCustomDomain);
if (cdPanel) cdPanel.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cd]'); if (!b) return;
  const act = b.getAttribute('data-cd');
  if (act === 'copy') { try { navigator.clipboard.writeText(b.getAttribute('data-val') || ''); const t = b.textContent; b.textContent = 'Copiato'; setTimeout(() => { b.textContent = t; }, 1200); } catch (e) {} }
  else if (act === 'verify') verifyCustomDomain();
  else if (act === 'unlink') unlinkCustomDomain();
});

function openConciergeDialog() {
  if (!currentId) return;
  closeSettings();
  const ov = document.createElement('div');
  ov.className = 'modal';
  ov.innerHTML =
    '<div class="modal-card compact">' +
    '<div class="modal-head"><h3>Richiedi un dominio ufficiale</h3><button class="icon-btn" data-act="close" aria-label="Chiudi">×</button></div>' +
    '<p class="set-note" style="margin:0 0 12px">Dicci il dominio che vorresti. Lo acquistiamo e configuriamo noi: ti contattiamo entro 24 ore. Non tocchi nulla di tecnico.</p>' +
    '<div class="set-row"><label for="cgDomain">Dominio desiderato</label><input id="cgDomain" class="text-input" type="text" placeholder="es. nomeazienda.it" spellcheck="false" autocapitalize="off" /></div>' +
    '<div class="set-row"><label for="cgEmail">Email di contatto</label><input id="cgEmail" class="text-input" type="email" placeholder="tua@email.it" /></div>' +
    '<div class="cg-2">' +
    '<div class="set-row"><label for="cgName">Nome / azienda</label><input id="cgName" class="text-input" type="text" /></div>' +
    '<div class="set-row"><label for="cgPhone">Telefono (facolt.)</label><input id="cgPhone" class="text-input" type="tel" /></div>' +
    '</div>' +
    '<div class="set-row"><label for="cgNote">Note (facoltativo)</label><input id="cgNote" class="text-input" type="text" placeholder="alternative, preferenze…" /></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:2px"><button class="btn accent" data-act="send">Invia richiesta</button></div>' +
    '</div>';
  document.body.appendChild(ov);
  const close = () => ov.remove();
  const email = ov.querySelector('#cgEmail');
  if (email) email.value = currentEmail || '';
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-act="close"]').addEventListener('click', close);
  ov.querySelector('[data-act="send"]').addEventListener('click', async () => {
    const desiredDomain = ov.querySelector('#cgDomain').value.trim();
    const contactEmail = ov.querySelector('#cgEmail').value.trim();
    const contactName = ov.querySelector('#cgName').value.trim();
    const phone = ov.querySelector('#cgPhone').value.trim();
    const note = ov.querySelector('#cgNote').value.trim();
    if (!desiredDomain) { ov.querySelector('#cgDomain').focus(); return; }
    if (!contactEmail) { email.focus(); return; }
    const data = await api('POST', `/api/projects/${encodeURIComponent(currentId)}/concierge`, { desiredDomain, contactEmail, contactName, phone, note });
    if (!data.ok) return addMsg('bot', `<p class="tiny">Invio non riuscito: ${escapeHtml(data.error?.message || '')}</p>`, 'err');
    close();
    addMsg('bot', `<p>Richiesta inviata per <strong>${escapeHtml(desiredDomain)}</strong>. Ti contattiamo entro 24 ore per attivarlo. Nel frattempo il sito resta online.</p>`, 'ok-note');
  });
  ov.querySelector('#cgDomain').focus();
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
function setProjLabel(id) {
  const p = id ? projectList.find((x) => x.id === id) : null;
  const name = p ? (p.title || p.id) : '— progetti —';
  projBtn.innerHTML = '<span class="proj-btn-label">' + escapeHtml(name) + '</span> <span class="caret">▾</span>';
}

function closeProjMenu() { if (projMenu) { projMenu.hidden = true; projBtn.setAttribute('aria-expanded', 'false'); } }
function toggleProjMenu() {
  if (!projMenu) return;
  const open = projMenu.hidden;
  if (open) renderProjMenu();
  projMenu.hidden = !open;
  projBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function renderProjMenu() {
  projMenu.innerHTML = '';
  if (!projectList.length) {
    const empty = document.createElement('p');
    empty.className = 'proj-empty';
    empty.textContent = 'Nessun progetto ancora.';
    projMenu.appendChild(empty);
    return;
  }
  projectList.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'proj-row' + (p.id === currentId ? ' active' : '');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'proj-open';
    open.innerHTML = `<span class="proj-name">${escapeHtml(p.title || p.id)}</span><span class="proj-meta">v${p.version} · ${escapeHtml(p.status)}</span>`;
    open.addEventListener('click', () => { closeProjMenu(); openProject(p.id); });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'proj-del';
    del.title = 'Elimina definitivamente';
    del.setAttribute('aria-label', 'Elimina ' + (p.title || p.id));
    del.textContent = '×';
    del.addEventListener('click', (e) => { e.stopPropagation(); confirmDeleteProject(p.id, p.title || p.id); });
    row.appendChild(open);
    row.appendChild(del);
    projMenu.appendChild(row);
  });
}

function confirmDeleteProject(id, label) {
  closeProjMenu();
  const ov = document.createElement('div');
  ov.className = 'modal';
  ov.innerHTML =
    '<div class="modal-card">' +
    '<div class="modal-head"><h3>Eliminare il progetto?</h3></div>' +
    `<p class="set-note" style="margin:0 0 18px">«${escapeHtml(label)}» verrà eliminato <strong>definitivamente</strong> da brik. L'operazione non è reversibile. Se il sito era pubblicato, l'indirizzo .pages.dev può restare attivo finché non lo rimuovi da Cloudflare.</p>` +
    '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">' +
    '<button class="btn ghost" data-act="cancel">Annulla</button>' +
    '<button class="btn danger" data-act="del">Elimina</button>' +
    '</div></div>';
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-act="cancel"]').addEventListener('click', close);
  ov.querySelector('[data-act="del"]').addEventListener('click', async () => {
    close();
    const data = await api('POST', `/api/projects/${encodeURIComponent(id)}/delete`, {});
    if (!data.ok) return addMsg('bot', `<p class="tiny">Eliminazione non riuscita: ${escapeHtml(data.error?.message || '')}</p>`, 'err');
    if (id === currentId) resetToNew();
    if (readLastProject() === id) clearLastProject();
    await refreshProjects(id === currentId ? '' : currentId);
  });
}

async function refreshProjects(selected) {
  const data = await api('GET', '/api/projects');
  projectList = data.ok && Array.isArray(data.projects) ? data.projects : [];
  setProjLabel(selected || currentId || '');
  if (!projMenu.hidden) renderProjMenu();
}

// ---------- azioni ----------
function attachedNamesHtml(list) {
  if (!list || !list.length) return '';
  return '<p class="msg-files">' + list.map((n) => (n && n.image ? '🖼 ' : '📎 ') + escapeHtml(n && n.name ? n.name : String(n))).join('<br>') + '</p>';
}
// Pizzeria Pack 4 — Starting Point Intake: primo step "Da dove vuoi partire?".
// Compare prima delle domande verticali, una scelta alla volta, senza bloccare gli esperti.
// Il risultato (mode + eventuali dati) viene passato alla create nel body, non nella descrizione.
function askStartingPoint(onComplete) {
  const STARTING_OPTS = [
    ['Ho già un sito da rifare', 'existing-site'],
    ['Ho Instagram / Facebook / Google Maps', 'social-or-maps'],
    ['Ho menu, foto o testi da caricare', 'materials'],
    ['Parto da zero e voglio essere guidato', 'guided-from-zero'],
    ['So già cosa voglio, scrivo tutto io', 'free-description'],
  ];
  const TREATMENTS = [
    ['Mantieni contenuti e dati, ma rendilo più moderno', 'keep-content-modernize'],
    ['Mantieni lo stile, ma miglioralo', 'keep-style-improve'],
    ['Cambia completamente direzione', 'change-direction'],
    ['Usa solo i dati, non lo stile', 'use-data-only'],
    ['Non so, consigliami tu', 'advise-me'],
  ];
  const wrap = document.createElement('div');
  wrap.className = 'msg bot intake';
  messages.appendChild(wrap);

  const done = (sp) => {
    wrap.querySelectorAll('button, input, textarea').forEach((e) => (e.disabled = true));
    onComplete(sp);
  };
  const title = (txt) => {
    const p = document.createElement('p');
    p.textContent = txt;
    p.style.margin = '0 0 10px';
    p.style.fontWeight = '600';
    return p;
  };
  const optionRow = (opts, onPick) => {
    const box = document.createElement('div');
    box.className = 'opts';
    opts.forEach(([label, val]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.textContent = label;
      b.addEventListener('click', () => onPick(val));
      box.appendChild(b);
    });
    return box;
  };
  const nextButton = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opt';
    b.textContent = label;
    b.style.marginTop = '10px';
    b.addEventListener('click', onClick);
    return b;
  };

  const renderTreatment = (url) => {
    wrap.innerHTML = '';
    wrap.appendChild(title('Come vuoi trattare il sito attuale?'));
    wrap.appendChild(optionRow(TREATMENTS, (treatment) => {
      done({ mode: 'existing-site', ...(url ? { existingSiteUrl: url } : {}), currentSiteTreatment: treatment });
    }));
  };
  const renderExistingUrl = () => {
    wrap.innerHTML = '';
    wrap.appendChild(title('Incolla il link del sito attuale. Lo userò per recuperare dati utili come nome, menu, contatti, orari e pagine già presenti.'));
    const inp = document.createElement('input');
    inp.type = 'url';
    inp.className = 'q-text';
    inp.placeholder = 'https://...';
    wrap.appendChild(inp);
    wrap.appendChild(nextButton('Avanti', () => renderTreatment((inp.value || '').trim())));
  };
  const renderSocial = () => {
    wrap.innerHTML = '';
    wrap.appendChild(title('Incolla i link che vuoi usare. Puoi inserire Instagram, Facebook o Google Maps.'));
    const ta = document.createElement('textarea');
    ta.className = 'q-text';
    ta.rows = 3;
    ta.placeholder = 'https://instagram.com/...\nhttps://maps.app.goo.gl/...';
    wrap.appendChild(ta);
    wrap.appendChild(nextButton('Avanti', () => done({ mode: 'social-or-maps', socialText: (ta.value || '').trim() })));
  };
  const renderMaterials = () => {
    wrap.innerHTML = '';
    wrap.appendChild(title('Incolla qui menu, testi o indicazioni che vuoi usare. Se hai foto/logo, caricali quando richiesto.'));
    const ta = document.createElement('textarea');
    ta.className = 'q-text';
    ta.rows = 4;
    ta.placeholder = 'Es. menu, orari, cosa ti rende diverso...';
    wrap.appendChild(ta);
    wrap.appendChild(nextButton('Avanti', () => {
      const txt = (ta.value || '').trim();
      done({ mode: 'materials', ...(txt ? { materials: { notes: txt } } : {}) });
    }));
  };
  const renderStart = () => {
    wrap.innerHTML = '';
    wrap.appendChild(title('Da dove vuoi partire?'));
    wrap.appendChild(optionRow(STARTING_OPTS, (mode) => {
      if (mode === 'existing-site') renderExistingUrl();
      else if (mode === 'social-or-maps') renderSocial();
      else if (mode === 'materials') renderMaterials();
      else done({ mode });
    }));
  };
  renderStart();
}

// Pizzeria Pack 5 — Intake verticale: domande specifiche quando il progetto è una pizzeria.
// Una domanda alla volta; le risposte (per id) vanno alla create e popolano il profilo.
function askPizzeriaVertical(questions, onComplete) {
  const answers = {};
  const selections = questions.map(() => new Set());
  let i = 0;
  const wrap = document.createElement('div');
  wrap.className = 'msg bot intake';
  messages.appendChild(wrap);

  const finish = () => {
    wrap.querySelectorAll('button, input, textarea').forEach((e) => (e.disabled = true));
    onComplete(answers);
  };
  const goNext = () => { i += 1; if (i >= questions.length) finish(); else step(); };
  const mkBtn = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opt';
    b.textContent = label;
    b.style.marginTop = '10px';
    b.addEventListener('click', onClick);
    return b;
  };

  function step() {
    const q = questions[i];
    wrap.innerHTML = '';
    const prog = document.createElement('p');
    prog.className = 'intake-prog';
    prog.textContent = `Domanda ${i + 1} di ${questions.length}`;
    prog.style.margin = '0 0 8px';
    wrap.appendChild(prog);
    const ttl = document.createElement('p');
    ttl.textContent = q.question;
    ttl.style.fontWeight = '600';
    ttl.style.margin = '0 0 10px';
    wrap.appendChild(ttl);

    if (q.freeText) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'q-text';
      inp.placeholder = 'Scrivi qui...';
      wrap.appendChild(inp);
      wrap.appendChild(mkBtn('Avanti', () => { const v = (inp.value || '').trim(); if (v) answers[q.id] = v; goNext(); }));
      return;
    }

    const opts = document.createElement('div');
    opts.className = 'opts';
    (q.options || []).forEach((opt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt' + (selections[i].has(opt) ? ' sel' : '');
      b.textContent = opt;
      b.addEventListener('click', () => {
        if (q.multi) {
          if (selections[i].has(opt)) { selections[i].delete(opt); b.classList.remove('sel'); }
          else { selections[i].add(opt); b.classList.add('sel'); }
        } else {
          answers[q.id] = opt;
          goNext();
        }
      });
      opts.appendChild(b);
    });
    wrap.appendChild(opts);
    if (q.multi) {
      wrap.appendChild(mkBtn('Avanti', () => { const arr = [...selections[i]]; if (arr.length) answers[q.id] = arr; goNext(); }));
    }
  }

  step();
}

// Stato piano pi\u00f9 recente (impostato da updatePlanChip), per alimentare il pannello.
let _lastPlanState = null;

function _showPlansPanel() {
  const st = _lastPlanState || {};
  const maxPub = Number(st.accountMaxPublished || 0);
  const used = projectList.filter((p) => p && p.status === 'published').length;
  const TIERS = [{ name: 'Base', sites: 3, price: '19\u20ac' }, { name: 'Plus', sites: 10, price: '39\u20ac' }, { name: 'Pro', sites: 30, price: '79\u20ac' }];
  const hasPlan = maxPub > 0;
  const next = TIERS.find((t) => t.sites > maxPub) || null;
  const curName = (TIERS.find((t) => t.sites === maxPub) || {}).name || (maxPub + ' siti');
  const hasSite = !!currentId;

  const tiersHtml = TIERS.map((t) => {
    const isCur = hasPlan && t.sites === maxPub;
    return '<div style="display:flex;justify-content:space-between;font-size:14px;padding:5px 0;' + (isCur ? 'font-weight:700;color:#1c7a4a;' : '') + '"><span>' + (isCur ? '\u2713 ' : '') + '<strong>' + t.name + '</strong> \u00b7 ' + t.sites + ' siti</span><span style="font-weight:700;">' + t.price + '/mese</span></div>';
  }).join('');

  const headHtml = hasPlan
    ? '<div style="font-size:14px;margin-bottom:10px;padding:10px 12px;border-radius:10px;background:#e3f6ec;color:#0f5a34;"><strong>Piano attuale: ' + curName + '</strong> \u00b7 ' + used + '/' + maxPub + ' siti pubblicati</div>'
    : '<div style="font-size:13.5px;color:#555;line-height:1.5;margin-bottom:10px;">Prova gratuita \u00b7 nessun piano attivo. <strong>3 giorni</strong> per costruire e valutare; per pubblicare attiva un piano.</div>';

  let actionHtml = '';
  if (hasSite && !hasPlan) {
    actionHtml = '<button id="planAction" type="button" data-act="checkout" style="width:100%;border:0;border-radius:10px;padding:12px;font-size:15px;font-weight:700;background:#5b5bf0;color:#fff;cursor:pointer;">Attiva il piano \u00b7 19\u20ac/mese</button>';
  } else if (hasSite && hasPlan && next) {
    actionHtml = '<button id="planAction" type="button" data-act="upgrade" style="width:100%;border:0;border-radius:10px;padding:12px;font-size:15px;font-weight:700;background:#5b5bf0;color:#fff;cursor:pointer;">Passa a ' + next.sites + ' siti \u00b7 ' + next.price + '/mese</button>';
  } else if (hasPlan && !next) {
    actionHtml = '<div style="font-size:13px;color:#555;text-align:center;">Sei al piano massimo (30 siti). Scrivici a <a href="mailto:ciao@thebrik.it">ciao@thebrik.it</a> per esigenze maggiori.</div>';
  }

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10001;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow:auto;';
  ov.innerHTML = '<div role="dialog" aria-modal="true" style="background:#fff;color:#111;max-width:460px;width:100%;border-radius:16px;padding:20px 22px 18px;box-shadow:0 24px 70px rgba(0,0,0,.4);">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;"><strong style="font-size:18px;">Piani e prezzi</strong><button id="plansClose" type="button" style="border:0;background:#eee;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:15px;">\u2715</button></div>'
    + headHtml
    + '<div style="border:1px solid #e6e6ee;border-radius:12px;padding:14px;margin-bottom:12px;">'
    +   '<div style="font-size:14px;font-weight:700;margin-bottom:6px;">Abbonamento mensile \u00b7 paghi solo per pubblicare</div>'
    +   tiersHtml
    +   '<div style="font-size:13px;color:#555;margin-top:8px;">Generare e modificare i siti \u00e8 gratis e illimitato.</div>'
    + '</div>'
    + actionHtml
    + '</div>';
  document.body.appendChild(ov);
  const close = () => ov.remove();
  const cb = ov.querySelector('#plansClose'); if (cb) cb.onclick = close;
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

  const act = ov.querySelector('#planAction');
  if (act) act.onclick = async () => {
    if (act.dataset.act === 'checkout') { close(); startCheckout(); return; }
    if (!currentId) return;
    act.disabled = true; act.textContent = 'Aggiorno il piano\u2026';
    try {
      const r = await api('POST', '/api/projects/' + encodeURIComponent(currentId) + '/upgrade');
      if (r && r.ok) { close(); addMsg('bot', '<p>Piano aggiornato a <strong>' + (r.nextMax || (next && next.sites)) + ' siti</strong>.</p>', 'ok-note'); return; }
      act.disabled = false; act.textContent = 'Passa a ' + next.sites + ' siti \u00b7 ' + next.price + '/mese';
      addMsg('bot', '<p>Upgrade non riuscito.</p><p class="tiny">' + escapeHtml((r && r.error && r.error.message) || '') + '</p>', 'err');
    } catch (e) {
      act.disabled = false; act.textContent = 'Passa a ' + next.sites + ' siti \u00b7 ' + next.price + '/mese';
      addMsg('bot', "<p>Errore nell'upgrade del piano.</p>", 'err');
    }
  };
}

// Chip "Piani" discreto e sempre visibile in cima alla chat: informa della prova senza bloccare.
let _planChip = null;
function _ensurePlanChip() {
  if (_planChip) return;
  const host = document.querySelector('section.preview') || document.querySelector('section.chat');
  if (!host) return;
  _planChip = document.createElement('button');
  _planChip.type = 'button';
  _planChip.id = 'planChip';
  _planChip.hidden = true;
  _planChip.style.cssText = 'display:block;width:fit-content;max-width:92%;margin:6px auto;flex:0 0 auto;border:1px solid var(--line-2,#e2e2ec);border-radius:999px;background:var(--panel-2,#f4f4f8);color:inherit;padding:3px 11px;font-size:12px;line-height:1.3;cursor:pointer;opacity:.85;';
  _planChip.onclick = _showPlansPanel;
  host.insertBefore(_planChip, host.firstChild);
}
function updatePlanChip(st) {
  _lastPlanState = st || _lastPlanState;
  _ensurePlanChip();
  if (!_planChip) return;
  let txt = 'Piani e prezzi';
  if (st && (st.entitled || st.planActive)) txt = 'Piano attivo';
  else if (st && st.status === 'locked') txt = 'In pausa \u00b7 riattiva';
  else if (st && st.trialPhase === 'trial' && st.trialDaysLeft != null) txt = 'Prova \u00b7 ' + st.trialDaysLeft + 'g';
  _planChip.innerHTML = '<span style="opacity:.6;margin-right:5px;">\u24d8</span>' + txt;
  _planChip.hidden = false;
}

// Soglia "descrizione sufficiente": >= 15 caratteri e >= 2 parole (dopo trim).
// Sopra soglia il path "scrivo io / so già cosa voglio" è implicito → si salta
// lo step "Da dove vuoi partire?". Sotto soglia (input troppo corto) lo step resta,
// così restano raggiungibili anche i path da sito/social/materiali esistenti.
function isSelfDescribed(text) {
  const t = (text || '').trim();
  return t.length >= 15 && t.split(/\s+/).filter(Boolean).length >= 2;
}

async function beginCreate(description, sources = [], images = [], attachedNames = []) {
  hideLanding();
  addMsg('user', escapeHtml(description) + attachedNamesHtml(attachedNames));
  clearAttachments();
  updateComposerMode();
  // Per tutta la durata dell'intake la chat non si usa: resta solo "Avanti" nelle domande.
  intakeActive = true;
  disableSend(true);
  // Noto lo starting point, prosegue col flusso esistente (pizzeria verticale o intake generico).
  const afterStartingPoint = async (sp) => {
    pendingStartingPoint = sp || null;
    // Se è chiaramente una pizzeria, domande verticali specifiche prima delle altre.
    try {
      const plan = await api('POST', '/api/pizzeria-intake', { description, ...(sp ? { startingPoint: sp } : {}) });
      const vq = plan && plan.ok && plan.active && Array.isArray(plan.questions) ? plan.questions : [];
      if (vq.length) {
        askPizzeriaVertical(vq, (ans) => { pendingPizzeriaAnswers = ans || null; void continueCreate(description, sources, images); });
        return;
      }
    } catch (e) { /* se il piano fallisce, prosegui senza domande verticali */ }
    void continueCreate(description, sources, images);
  };
  // Opzione B: descrizione già sufficiente → path "scrivo io" implicito, salta "Da dove vuoi partire?"
  // ed entra diretto nello step successivo. Descrizione breve → mostra lo step (path da sito/social raggiungibili).
  if (isSelfDescribed(description)) afterStartingPoint({ mode: 'free-description' });
  else askStartingPoint(afterStartingPoint);
}

async function continueCreate(description, sources = [], images = []) {
  pendingCreate = { description, sources, images };
  intakeActive = true;
  disableSend(true);
  // Pizzeria: le domande verticali bastano → niente intake generico (era un doppione con design diverso).
  // createSite legge pizzeriaAnswers dalla globale, quindi non si perde nulla.
  if (pendingPizzeriaAnswers) {
    pendingCreate = null;
    askStyle(description, smartDefaultTheme(description), (theme, opts) => createSite(description, [], sources, images, theme, opts));
    return;
  }
  const t = thinking('Preparo un paio di domande');
  const data = await api('POST', '/api/intake', { description });
  t.remove();
  const qs = data && data.ok && Array.isArray(data.questions) ? data.questions : [];
  const rec = data && typeof data.recommendedStyle === 'string' ? data.recommendedStyle : '';
  if (qs.length) {
    askQuestions(qs, (collected) => {
      const { description: d, sources: s, images: im } = pendingCreate;
      pendingCreate = null;
      askStyle(d, rec, (theme, opts) => createSite(d, collected, s || [], im || [], theme, opts));
    });
  } else {
    askStyle(description, rec, (theme, opts) => createSite(description, [], sources, images, theme, opts));
  }
}

const STYLES = [
  { id: 'editorial-luxury', name: 'Editorial Luxury' },
  { id: 'athletic-premium', name: 'Athletic Premium' },
  { id: 'scandinavian-service', name: 'Scandinavian Service' },
  { id: 'warm-bistro', name: 'Warm Bistro' },
  { id: 'modern-saas', name: 'Modern SaaS' },
  { id: 'creative-studio', name: 'Creative Studio' },
  { id: 'future-minimal', name: 'Future Minimal' },
  { id: 'modern-community', name: 'Modern Community' },
  { id: 'industrial-bold', name: 'Industrial Bold' },
];
const STYLE_KEYWORDS = [
  ['warm-bistro', ['pizzeria', 'pizza', 'trattoria', 'osteria', 'forno a legna', 'panificio', 'pasticceria', 'gelateria', 'agriturismo', 'catering', 'food truck']],
  ['athletic-premium', ['palestra', 'gym', 'crossfit', 'fitness', 'personal trainer', 'allenament', 'boxe', 'pilates', 'sport', 'atleta', 'performance', 'wellness']],
  ['future-minimal', ['intelligenza artificiale', 'machine learning', 'deep learning', 'llm', 'agente ai', 'assistente ai', 'futuristic', 'futurist', 'tecnologia emergente', 'tech innovativ']],
  ['modern-saas', ['software', 'saas', 'piattaforma', 'gestionale', 'dashboard', 'startup', 'applicazione', 'web app', 'cloud', 'automazione', 'crm', 'prodotto digitale', 'tool ']],
  ['creative-studio', ['studio creativo', 'agenzia creativa', 'art direction', 'direzione artistica', 'graphic design', 'design studio', 'designer', 'fotograf', 'videomaker', 'brand identity', 'portfolio', 'illustrazione', 'motion design']],
  ['modern-community', ['community', 'membership', 'creator', 'club', 'coworking', 'academy', 'accademia', 'iscritti', 'membri', 'abbonati', 'newsletter', 'mastermind']],
  ['industrial-bold', ['industria', 'manifattura', 'produzione', 'edilizia', 'logistica', 'impianti', 'energia', 'automotive', 'macchinari', 'meccanic', 'fabbrica', 'stabilimento', 'officina', 'cantiere', 'metalmeccanic', 'costruzioni']],
  ['scandinavian-service', ['architett', 'interni', 'interior', 'studio', 'design', 'consulen', 'avvocat', 'commercialist', 'notaio', 'professionist', 'ingegner', 'dentist']],
];
function smartDefaultTheme(desc) {
  const d = (desc || '').toLowerCase();
  for (const [theme, kws] of STYLE_KEYWORDS) { if (kws.some((k) => d.includes(k))) return theme; }
  return 'scandinavian-service';
}
// Meta di presentazione del catalogo stili (solo UI). Chiave = theme id (invariato,
// alimenta la generazione). title = 1 parola dentro la preview; name+mood nel footer.
const STYLE_PREVIEW_META = {
  'editorial-luxury':     { title: 'Maison',  name: 'Editorial Luxury',     mood: 'elegante · autorevole · editoriale', previewKind: 'editorialLuxury' },
  'athletic-premium':     { title: 'Apex',    name: 'Athletic Premium',     mood: 'energetico · tecnico · premium',     previewKind: 'athleticPremium' },
  'scandinavian-service': { title: 'Stille',  name: 'Scandinavian Service', mood: 'calmo · chiaro · affidabile',         previewKind: 'scandinavianService' },
  'warm-bistro':          { title: 'Forno',   name: 'Warm Bistro',          mood: 'caldo · artigianale · conviviale',    previewKind: 'warmBistro' },
  'modern-saas':          { title: 'Cadence', name: 'Modern SaaS',          mood: 'scuro · preciso · digitale',          previewKind: 'modernSaas' },
  'creative-studio':      { title: 'Studio',  name: 'Creative Studio',      mood: 'grafico · bold · culturale',          previewKind: 'creativeStudio' },
  'future-minimal':       { title: 'Halo',    name: 'Future Minimal',       mood: 'pulito · futuribile · prodotto',      previewKind: 'futureMinimal' },
  'modern-community':     { title: 'Atelier', name: 'Modern Community',     mood: 'umano · locale · partecipativo',      previewKind: 'modernCommunity' },
  'industrial-bold':      { title: 'Ferro',   name: 'Industrial Bold',      mood: 'solido · materico · diretto',         previewKind: 'industrialBold' },
};
// Markup interno di una preview: header (titolo 1 parola + dot) + body con 3 blocchi
// decorativi generici (.pv1/.pv2/.pv3) che ogni variante .preview-* stila a modo suo.
function stylePreviewInnerHTML(m) {
  return (
    '<span class="previewHeader"><span class="previewTitle">' + m.title + '</span><span class="previewDot"></span></span>' +
    '<span class="previewBody"><i class="pv pv1"></i><i class="pv pv2"></i><i class="pv pv3"></i></span>'
  );
}
function askStyle(description, recommended, onPick) {
  intakeActive = true;
  disableSend(true);
  const valid = STYLES.some((s) => s.id === recommended);
  let chosen = valid ? recommended : smartDefaultTheme(description);

  const wrap = document.createElement('div');
  wrap.className = 'msg bot intake style-step';
  messages.appendChild(wrap);

  const head = document.createElement('p');
  head.className = 'q';
  head.textContent = 'Stile';
  wrap.appendChild(head);

  const hint = document.createElement('p');
  hint.className = 'intake-hint';
  hint.textContent = 'Per la tua attività ho scelto uno stile, se ti va puoi cambiarlo dopo.';
  wrap.appendChild(hint);

  // Anteprima dello stile consigliato (moodboard CSS, formato grande).
  const preview = document.createElement('div');
  preview.className = 'stylePreview stylePreview--lead';
  const nameEl = document.createElement('p');
  nameEl.style.cssText = 'text-align:center;font-weight:600;margin:8px 0 2px;font-size:14px;';
  const renderPreview = () => {
    const m = STYLE_PREVIEW_META[chosen] || STYLE_PREVIEW_META[STYLES[0].id];
    preview.className = 'stylePreview stylePreview--lead preview-' + m.previewKind;
    preview.innerHTML = stylePreviewInnerHTML(m);
    nameEl.textContent = m.name;
  };
  wrap.appendChild(preview);
  wrap.appendChild(nameEl);

  // Catalogo completo (Style Preview Cards), nascosto finché non chiede di vederlo.
  // NB: uso display inline, non l'attributo hidden — .catalogGrid ha un display nel CSS che lo sovrascriverebbe.
  const grid = document.createElement('div');
  grid.className = 'catalogGrid';
  grid.style.display = 'none';
  const cards = {};
  STYLES.forEach((s) => {
    const m = STYLE_PREVIEW_META[s.id];
    if (!m) return;
    const sel = s.id === chosen;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'styleCard';
    b.dataset.themeId = s.id;
    b.dataset.selected = sel ? 'true' : 'false';
    b.setAttribute('aria-pressed', sel ? 'true' : 'false');
    b.setAttribute('aria-label', 'Seleziona ' + m.name + ', ' + m.mood.replace(/ · /g, ' '));
    b.innerHTML =
      '<span class="stylePreview preview-' + m.previewKind + '">' + stylePreviewInnerHTML(m) + '</span>' +
      '<span class="styleFooter"><span class="styleName">' + m.name + '</span><span class="styleMood">' + m.mood + '</span></span>';
    b.addEventListener('click', () => {
      chosen = s.id;
      Object.values(cards).forEach((c) => { c.dataset.selected = 'false'; c.setAttribute('aria-pressed', 'false'); });
      b.dataset.selected = 'true';
      b.setAttribute('aria-pressed', 'true');
      renderPreview();
    });
    cards[s.id] = b;
    grid.appendChild(b);
  });
  wrap.appendChild(grid);

  const ctrls = document.createElement('div');
  ctrls.className = 'intake-controls';
  const seeAll = document.createElement('button');
  seeAll.type = 'button';
  seeAll.className = 'btn ghost';
  seeAll.textContent = 'Non fa per me — scegli dal catalogo';
  seeAll.addEventListener('click', () => {
    const show = grid.style.display === 'none';
    grid.style.display = show ? '' : 'none';
    seeAll.textContent = show ? 'Nascondi il catalogo' : 'Non fa per me — scegli dal catalogo';
    if (show) { messages.scrollTop = messages.scrollHeight; }
  });
  ctrls.appendChild(seeAll);
  const spacer = document.createElement('span');
  spacer.style.flex = '1';
  ctrls.appendChild(spacer);
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn accent';
  go.textContent = 'Crea con questo stile';
  go.addEventListener('click', () => {
    wrap.querySelectorAll('button').forEach((e) => (e.disabled = true));
    wrap.classList.add('done');
    askVisualOptions(chosen, (opts) => onPick(chosen, opts));
  });
  ctrls.appendChild(go);
  wrap.appendChild(ctrls);

  renderPreview();
  messages.scrollTop = messages.scrollHeight;
}

// Domanda condizionale dopo la scelta del tema:
// - modern-saas: come mostrare il prodotto (screenshot utente / UI generata / nessuno)
// - creative-studio: tema chiaro o scuro
function askVisualOptions(theme, onDone) {
  let cfg = null;
  if (theme === 'modern-saas') {
    cfg = {
      head: 'Il prodotto da mostrare',
      hint: 'Come vuoi rappresentare il prodotto nel sito?',
      options: [
        { label: 'Ho già degli screenshot', sub: 'Allegali al messaggio: li usiamo come immagini reali del prodotto.', value: { saasVisual: 'user' } },
        { label: 'Generate voi una UI di esempio', sub: 'Interfacce in CSS, anche diverse dal prodotto reale — utili se vuoi solo validare.', value: { saasVisual: 'generated' } },
        { label: 'Nessun visual del prodotto', sub: 'Solo testo, niente mockup né screenshot.', value: { saasVisual: 'none' } },
      ],
    };
  } else if (theme === 'creative-studio' || theme === 'future-minimal' || theme === 'modern-community' || theme === 'industrial-bold') {
    const darkFirst = theme === 'industrial-bold';
    const light = { label: 'Chiaro', sub: 'Versione luminosa.', value: { variant: 'light' } };
    const dark = { label: 'Scuro', sub: 'Fondo scuro, elegante.', value: { variant: 'dark' } };
    cfg = {
      head: 'Chiaro o scuro',
      hint: 'Che versione preferisci per il sito?',
      options: darkFirst ? [dark, light] : [light, dark],
    };
  }
  if (!cfg) { intakeActive = false; disableSend(false); onDone({}); return; }

  intakeActive = true;
  disableSend(true);
  const wrap = document.createElement('div');
  wrap.className = 'msg bot intake';
  messages.appendChild(wrap);

  const head = document.createElement('p');
  head.className = 'q';
  head.textContent = cfg.head;
  wrap.appendChild(head);

  const hint = document.createElement('p');
  hint.className = 'intake-hint';
  hint.textContent = cfg.hint;
  wrap.appendChild(hint);

  const opts = document.createElement('div');
  opts.className = 'opts';
  cfg.options.forEach((opt) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opt';
    b.style.cssText = 'display:block;width:100%;text-align:left;margin:6px 0;padding:12px 14px;line-height:1.4';
    b.innerHTML = '<strong>' + opt.label + '</strong>' + (opt.sub ? '<span style="display:block;opacity:.62;font-size:.86em;margin-top:3px">' + opt.sub + '</span>' : '');
    b.addEventListener('click', () => {
      intakeActive = false;
      disableSend(false);
      wrap.querySelectorAll('button').forEach((e) => (e.disabled = true));
      b.classList.add('sel');
      wrap.classList.add('done');
      onDone(opt.value);
    });
    opts.appendChild(b);
  });
  wrap.appendChild(opts);
  messages.scrollTop = messages.scrollHeight;
}

function askQuestions(questions, onComplete) {
  const texts = questions.map(() => '');
  const selections = questions.map(() => new Set());
  let i = 0;
  let mode = 'step';
  let pasteAll = '';
  const wrap = document.createElement('div');
  wrap.className = 'msg bot intake';
  messages.appendChild(wrap);

  const answerOf = (k) => {
    const parts = [...selections[k]];
    const t = (texts[k] || '').trim();
    if (t) parts.push(t);
    return parts.join(', ');
  };
  const finishIntake = () => {
    intakeActive = false;
    disableSend(false);
    const collected = questions
      .map((q, k) => ({ question: q.question, answer: answerOf(k) }))
      .filter((a) => a.answer);
    const blob = (pasteAll || '').trim();
    if (blob) collected.push({ question: 'Altre informazioni dal cliente', answer: blob });
    wrap.querySelectorAll('button, input, textarea').forEach((e) => (e.disabled = true));
    onComplete(collected);
  };
  const goNext = () => { i += 1; if (i >= questions.length) finishIntake(); else step(); };
  const goBack = () => { if (i > 0) { i -= 1; step(); } };

  // Chip delle opzioni per la domanda k (riusate da entrambe le viste).
  const optionChips = (k) => {
    const opts = document.createElement('div');
    opts.className = 'opts';
    (questions[k].options || []).forEach((opt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt' + (selections[k].has(opt) ? ' sel' : '');
      b.textContent = opt;
      b.addEventListener('click', () => {
        if (selections[k].has(opt)) { selections[k].delete(opt); b.classList.remove('sel'); }
        else { selections[k].add(opt); b.classList.add('sel'); }
      });
      opts.appendChild(b);
    });
    return opts;
  };

  const step = () => {
    mode = 'step';
    const q = questions[i];
    const last = i === questions.length - 1;
    const multi = Array.isArray(q.options) && q.options.length > 0;
    wrap.innerHTML = '';

    const top = document.createElement('div');
    top.className = 'intake-controls';
    const prog = document.createElement('p');
    prog.className = 'intake-prog';
    prog.textContent = `Domanda ${i + 1} di ${questions.length}`;
    prog.style.margin = '0';
    top.appendChild(prog);
    const sp0 = document.createElement('span'); sp0.style.flex = '1'; top.appendChild(sp0);
    const seeAll = document.createElement('button');
    seeAll.type = 'button';
    seeAll.className = 'intake-skipall';
    seeAll.textContent = 'Vedi tutte le domande';
    seeAll.addEventListener('click', () => { texts[i] = (wrap.querySelector('.q-text') || {}).value ?? texts[i]; allView(); });
    top.appendChild(seeAll);
    wrap.appendChild(top);

    const qp = document.createElement('p');
    qp.className = 'q';
    qp.textContent = q.question;
    wrap.appendChild(qp);

    if (multi) {
      const hint = document.createElement('p');
      hint.className = 'intake-hint';
      hint.textContent = 'Puoi sceglierne anche più di una.';
      wrap.appendChild(hint);
      wrap.appendChild(optionChips(i));
    }

    const row = document.createElement('div');
    row.className = 'intake-row';
    const ti = document.createElement('input');
    ti.type = 'text';
    ti.className = 'q-text';
    ti.value = texts[i] || '';
    ti.placeholder = multi ? 'oppure aggiungi una risposta…' : 'scrivi una risposta…';
    ti.addEventListener('input', () => { texts[i] = ti.value; });
    ti.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); texts[i] = ti.value.trim(); goNext(); }
    });
    row.appendChild(ti);
    wrap.appendChild(row);

    const ctrls = document.createElement('div');
    ctrls.className = 'intake-controls';
    if (i > 0) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn ghost';
      back.textContent = '← Indietro';
      back.addEventListener('click', () => { texts[i] = ti.value; goBack(); });
      ctrls.appendChild(back);
    }
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    ctrls.appendChild(spacer);
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'btn ghost';
    skip.textContent = last ? 'Salta e costruisci' : 'Salta';
    skip.addEventListener('click', () => { selections[i].clear(); texts[i] = ''; goNext(); });
    ctrls.appendChild(skip);
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn accent';
    next.textContent = last ? 'Costruisci' : 'Avanti';
    next.addEventListener('click', () => { texts[i] = ti.value.trim(); goNext(); });
    ctrls.appendChild(next);
    wrap.appendChild(ctrls);

    if (!last) {
      const allRow = document.createElement('div');
      allRow.className = 'intake-controls';
      const skipAll = document.createElement('button');
      skipAll.type = 'button';
      skipAll.className = 'intake-skipall';
      skipAll.textContent = 'Salta tutte le domande';
      skipAll.addEventListener('click', finishIntake);
      allRow.appendChild(skipAll);
      wrap.appendChild(allRow);
    }

    requestAnimationFrame(() => {
      try { wrap.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { try { wrap.scrollIntoView(); } catch (e2) {} }
      try { ti.focus({ preventScroll: true }); } catch (e) { try { ti.focus(); } catch (e2) {} }
    });
  };

  // Vista "tutte insieme": rispondi con calma o copia le domande per inoltrarle.
  const allView = () => {
    mode = 'all';
    wrap.innerHTML = '';

    const top = document.createElement('div');
    top.className = 'intake-controls';
    const prog = document.createElement('p');
    prog.className = 'intake-prog';
    prog.textContent = questions.length + ' domande';
    prog.style.margin = '0';
    top.appendChild(prog);
    const sp0 = document.createElement('span'); sp0.style.flex = '1'; top.appendChild(sp0);
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'intake-skipall';
    copyBtn.textContent = 'Copia le domande';
    copyBtn.addEventListener('click', () => {
      const txt = questions.map((q, k) => {
        let s = (k + 1) + '. ' + q.question;
        if (Array.isArray(q.options) && q.options.length) s += '\n   (' + q.options.join(' · ') + ')';
        return s;
      }).join('\n\n');
      const done = () => { copyBtn.textContent = 'Copiate ✓'; setTimeout(() => { copyBtn.textContent = 'Copia le domande'; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(done);
      else done();
    });
    top.appendChild(copyBtn);
    const single = document.createElement('button');
    single.type = 'button';
    single.className = 'intake-skipall';
    single.textContent = 'Una alla volta';
    single.addEventListener('click', () => { i = 0; step(); });
    top.appendChild(single);
    wrap.appendChild(top);

    const hint = document.createElement('p');
    hint.className = 'intake-hint';
    hint.textContent = 'Rispondi con calma. Puoi anche copiare le domande, farle compilare a qualcun altro e incollare le risposte qui sotto.';
    wrap.appendChild(hint);

    questions.forEach((q, k) => {
      const block = document.createElement('div');
      block.style.cssText = 'margin:14px 0;';
      const qp = document.createElement('p');
      qp.className = 'q';
      qp.textContent = (k + 1) + '. ' + q.question;
      block.appendChild(qp);
      if (Array.isArray(q.options) && q.options.length) block.appendChild(optionChips(k));
      const row = document.createElement('div');
      row.className = 'intake-row';
      const ti = document.createElement('input');
      ti.type = 'text';
      ti.className = 'q-text';
      ti.value = texts[k] || '';
      ti.placeholder = (Array.isArray(q.options) && q.options.length) ? 'oppure aggiungi una risposta…' : 'scrivi una risposta…';
      ti.addEventListener('input', () => { texts[k] = ti.value; });
      row.appendChild(ti);
      block.appendChild(row);
      wrap.appendChild(block);
    });

    const pasteLabel = document.createElement('p');
    pasteLabel.className = 'intake-hint';
    pasteLabel.style.marginTop = '16px';
    pasteLabel.textContent = 'Oppure incolla qui tutte le risposte in un unico testo:';
    wrap.appendChild(pasteLabel);
    const pasteTa = document.createElement('textarea');
    pasteTa.value = pasteAll;
    pasteTa.placeholder = 'Incolla qui le risposte ricevute…';
    pasteTa.style.cssText = 'width:100%;min-height:90px;box-sizing:border-box;resize:vertical;';
    pasteTa.addEventListener('input', () => { pasteAll = pasteTa.value; });
    wrap.appendChild(pasteTa);

    const ctrls = document.createElement('div');
    ctrls.className = 'intake-controls';
    const skipAll = document.createElement('button');
    skipAll.type = 'button';
    skipAll.className = 'intake-skipall';
    skipAll.textContent = 'Salta tutte';
    skipAll.addEventListener('click', () => { questions.forEach((_, k) => { selections[k].clear(); texts[k] = ''; }); pasteAll = ''; finishIntake(); });
    ctrls.appendChild(skipAll);
    const spacer = document.createElement('span'); spacer.style.flex = '1'; ctrls.appendChild(spacer);
    const build = document.createElement('button');
    build.type = 'button';
    build.className = 'btn accent';
    build.textContent = 'Costruisci';
    build.addEventListener('click', finishIntake);
    ctrls.appendChild(build);
    wrap.appendChild(ctrls);

    messages.scrollTop = messages.scrollHeight;
  };

  step();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Polling della build asincrona: chiede lo stato del progetto finche non e pronto o fallisce.
// I singoli errori di rete NON interrompono — si riprova al giro dopo. Limite totale di sicurezza.
async function pollUntilReady(id, { intervalMs = 3000, maxMs = 12 * 60_000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(intervalMs);
    let data;
    try { data = await api('GET', `/api/projects/${encodeURIComponent(id)}`); }
    catch { continue; } // blip di rete: riprova
    if (!data) continue;
    if (data.gen === 'generating') continue;
    if (data.gen === 'error') return { ok: false, error: data.error };
    if (data.ok && data.state) return data; // pronto
    if (data.ok === false) {
      if (data.error && data.error.code === 'NEEDS_AUTH') return { ok: false, needsAuth: true };
      continue; // 404 transitorio subito dopo il POST: riprova ancora un po'
    }
  }
  return { ok: false, error: { message: 'La costruzione sta impiegando piu del previsto. Il sito potrebbe essere comunque pronto: ricarica la pagina tra poco.' } };
}

async function createSite(description, answers, sources = [], images = [], theme = '', opts = {}) {
  const t = thinking('Costruisco una prima bozza');
  addMsg('bot', '<p>La prima generazione può richiedere <strong>fino a ~10 minuti</strong>: Brik scrive i testi, sceglie lo stile e crea le pagine. È normale — lascialo lavorare senza ricaricare.</p>');
  setBusy(true, 'Sto costruendo la bozza…');
  setMobileView('preview');
  // Se l'utente è arrivato da un link-invito, manda il token: il server toglie il tetto ospite di 1 sito.
  const _inv = (() => { try { return localStorage.getItem('brik_invite') || ''; } catch (e) { return ''; } })();
  const _sp = pendingStartingPoint; pendingStartingPoint = null;
  const _pa = pendingPizzeriaAnswers; pendingPizzeriaAnswers = null;
  const start = await api('POST', '/api/projects', { description, answers: answers || [], sources: sources || [], images: images || [], ...(theme ? { theme } : {}), ...(opts && opts.saasVisual ? { saasVisual: opts.saasVisual } : {}), ...(opts && opts.variant ? { variant: opts.variant } : {}), ...(_inv ? { invite: _inv } : {}), ...(_sp ? { startingPoint: _sp } : {}), ...(_pa ? { pizzeriaAnswers: _pa } : {}) });
  if (!start || !start.ok) {
    t.remove(); setBusy(false);
    if (start && start.error?.code === 'NEEDS_AUTH') return;
    return addMsg('bot', `<p>Non sono riuscito a costruire il sito.</p><p class="tiny">${escapeHtml((start && start.error?.message) || '')}</p>`, 'err');
  }
  const id = start.id;
  saveLastProject(id); // salvo subito: se la pagina si ricarica durante la build, il sito si ritrova
  const data = await pollUntilReady(id);
  t.remove();
  setBusy(false);
  if (!data.ok) {
    if (data.needsAuth) return;
    return addMsg('bot', `<p>Non sono riuscito a costruire il sito.</p><p class="tiny">${escapeHtml(data.error?.message || '')}</p>`, 'err');
  }
  renderState(data);
  currentEmail = data.email || '';
  currentLegal = data.legal || {};
  currentUrl = '';
  saveLastProject(currentId);
  loadPreview(data.state.id, data.state.version);
  await refreshProjects(data.state.id);
  try { if (window.fbq) fbq('track', 'Lead'); } catch (e) {}
  addMsg('bot', `<p>Ecco una <strong>prima bozza</strong> — costruita e verificata. Guardala qui a fianco: ora rifiniamola insieme.</p>${summaryHtml(data.summary)}<p class="tiny">Dimmi cosa cambiare (testi, sezioni, colori, foto), oppure premi «Visita il sito» quando vuoi vederlo online.</p>`, 'ok-note');
}

async function editSite(instruction, sources = [], images = [], attachedNames = []) {
  addMsg('user', escapeHtml(instruction) + attachedNamesHtml(attachedNames));
  clearAttachments();
  updateComposerMode();

  // Modifiche brevi e dirette (es. "più spazio nel footer"): salta il pre-check di chiarimento,
  // che è un intero giro LLM. Per richieste lunghe o con domande, il pre-check resta.
  const direct = instruction.trim().length <= 80 && !instruction.includes('?');
  if (!direct) {
    const tc = thinking('Verifico la richiesta');
    setBusy(true, 'Verifico la richiesta…');
    let qs = [];
    try {
      const pre = await api('POST', `/api/projects/${encodeURIComponent(currentId)}/edit-clarify`, { instruction });
      qs = pre && pre.ok && Array.isArray(pre.questions) ? pre.questions : [];
    } catch { qs = []; }
    tc.remove();
    setBusy(false);
    if (qs.length) {
      intakeActive = true;
      disableSend(true);
      askQuestions(qs, (collected) => doEdit(enrichInstruction(instruction, collected), sources, images));
      return;
    }
  }
  doEdit(instruction, sources, images);
}

function enrichInstruction(instruction, answers) {
  if (!answers || !answers.length) return instruction;
  const lines = answers.map((a) => `- ${a.question} ${a.answer}`).join('\n');
  return instruction + '\n\nPrecisazioni:\n' + lines;
}

async function doEdit(instruction, sources = [], images = []) {
  const wasEditMode = !!editMode;
  const activeMobileView = mobileTabs && mobileTabs.querySelector('.mtab.active') ? mobileTabs.querySelector('.mtab.active').dataset.view : (wasEditMode ? 'modifica' : 'preview');
  const t = thinking('Applico la modifica');
  setBusy(true, 'Applico la modifica…');
  const data = await api('POST', `/api/projects/${encodeURIComponent(currentId)}/edit`, { instruction, sources: sources || [], images: images || [] });
  t.remove();
  setBusy(false);
  if (!data.ok) {
    const code = data.error?.code;
    if (code === 'NEEDS_AUTH') return;
    if (code === 'EDIT_CAP_REACHED') {
      const d = addMsg('bot', `<p>Hai usato tutte le modifiche incluse nella prova.</p><p class="tiny">Per continuare a modificare il sito, attiva un piano.</p><p><button type="button" class="btn accent" data-checkout="1">Attiva il piano · 19€/mese</button></p>`, 'err');
      const b = d.querySelector('[data-checkout]'); if (b) b.onclick = startCheckout;
      return d;
    }
    if (code === 'SITE_LOCKED') {
      const d = addMsg('bot', `<p>Il sito è in pausa.</p><p class="tiny">Riattivalo per poterlo modificare di nuovo.</p><p><button type="button" class="btn accent" data-checkout="1">Riattiva il piano · 19€/mese</button></p>`, 'err');
      const b = d.querySelector('[data-checkout]'); if (b) b.onclick = startCheckout;
      return d;
    }
    return addMsg('bot', `<p>Modifica non riuscita.</p><p class="tiny">${escapeHtml(data.error?.message || '')}</p>`, 'err');
  }
  renderState(data);
  if (data.accepted) {
    const keepEditing = wasEditMode || activeMobileView === 'modifica';
    if (keepEditing) {
      refreshPreviewFrameVersion(data.state.version);
      setMobileView('modifica');
    } else {
      loadPreview(currentId, data.state.version);
      setMobileView('preview');
    }
    await refreshProjects(currentId);
    const changes = (data.changes || []).length
      ? `<p class="tiny">Modifiche: ${escapeHtml(data.changes.join(' · '))}</p>`
      : '';
    const _editMsg = addMsg('bot', `<p>Modifica applicata.</p>${changes}${summaryHtml(data.summary)}<p style="margin-top:9px;"><button type="button" data-revert-last="1" title="Torna alla versione precedente" style="border:1px solid var(--line-2,#33384a);background:transparent;color:inherit;border-radius:8px;padding:5px 11px;font-size:12.5px;cursor:pointer;opacity:.6;transition:opacity .15s;">↩ Versione precedente</button></p>`, 'ok-note');
    const _rb = _editMsg && _editMsg.querySelector ? _editMsg.querySelector('[data-revert-last]') : null;
    if (_rb) {
      _rb.addEventListener('mouseenter', () => { _rb.style.opacity = '1'; });
      _rb.addEventListener('mouseleave', () => { _rb.style.opacity = '.6'; });
      _rb.onclick = () => { _rb.disabled = true; _rb.style.opacity = '.4'; revert(); };
    }
  } else {
    const list = (data.conflicts || []).map((c) => `<li>${escapeHtml(c.detail || c.kind)}</li>`).join('');
    addMsg('bot', `<p>Non posso applicarla: romperebbe qualcosa che avevi già chiesto.</p><ul>${list}</ul><p class="tiny">Il sito resta com'era. Riformula la richiesta o cambia il requisito esplicitamente.</p>`, 'err');
  }
}

const SUB_MAX = 58;
function subSanitize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
    .slice(0, SUB_MAX).replace(/-+$/, '');
}
function suggestSubdomain() {
  let base = currentId || 'sito';
  try {
    const doc = frameDoc();
    const h1 = doc && doc.querySelector('h1');
    const t = (h1 && h1.textContent) || (doc && doc.title) || '';
    if (t && t.trim()) base = t;
  } catch {}
  return subSanitize(base) || 'sito';
}

// --- Modale canonica publish/link: un solo overlay con stati idle/publishing/online/error ---
// Collassa le vecchie modali "Metti il sito online" (input sottodominio) e quella di stato/link
// (stato/link) in una sola. Rete e Cloudflare invariati: stesso endpoint /publish, stesso
// renderState, stessa finestra di propagazione (ACTIVATION_MS) per il passaggio publishing -> online.
function openSiteModal(initialState, ctx) {
  ctx = ctx || {};
  const ov = document.createElement('div');
  ov.className = 'modal';
  document.body.appendChild(ov);
  let activationTimer = null;
  const close = () => { if (activationTimer) { clearTimeout(activationTimer); activationTimer = null; } ov.remove(); };
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

  function shell(title, bodyHtml) {
    ov.innerHTML =
      '<div class="modal-card">' +
      '<div class="modal-head"><h3>' + escapeHtml(title) + '</h3>' +
      '<button class="icon-btn" data-act="close" aria-label="Chiudi">×</button></div>' +
      bodyHtml + '</div>';
    const c = ov.querySelector('[data-act="close"]');
    if (c) c.addEventListener('click', close);
  }

  function renderIdle() {
    const emailLine = currentEmail
      ? '<p class="set-note" style="margin:0 0 16px">Modulo di contatto: i messaggi arriveranno a <strong>' + escapeHtml(currentEmail) + '</strong>.</p>'
      : '<p class="set-note" style="margin:0 0 16px">⚠ Nessuna email di recapito: i messaggi del modulo <strong>non ti arriveranno</strong>. <button data-act="set" style="background:none;border:0;color:var(--accent);cursor:pointer;padding:0;font:inherit;text-decoration:underline">Imposta email</button></p>';
    const legalLine = (currentLegal && currentLegal.vat)
      ? ''
      : '<p class="set-note" style="margin:0 0 16px">Nessuna P.IVA impostata: il footer non la mostrerà. Per le attività è consigliato aggiungerla (puoi pubblicare comunque). <button data-act="setlegal" style="background:none;border:0;color:var(--accent);cursor:pointer;padding:0;font:inherit;text-decoration:underline">Aggiungi dati legali</button></p>';
    shell('Pubblica il sito',
      '<p class="set-note" style="margin:0 0 16px">Il tuo sito andrà online a questo indirizzo web. Lo trova <strong>solo chi ha il link</strong>: puoi rimetterlo in pausa o cambiarlo quando vuoi. Se non sei pronto, chiudi e resta nell’anteprima.</p>' +
      '<div class="set-row"><label for="subInput">Indirizzo del sito</label>' +
      '<div style="display:flex;align-items:center;gap:6px"><input id="subInput" class="text-input" type="text" spellcheck="false" autocapitalize="off"><span style="color:var(--ink-faint);font-size:13px;white-space:nowrap">.pages.dev</span></div>' +
      '<p class="set-note" id="subPreview" style="margin:6px 0 0"></p></div>' +
      emailLine + legalLine +
      '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="btn accent" data-act="pub">Pubblica sito</button></div>');
    const input = ov.querySelector('#subInput');
    const preview = ov.querySelector('#subPreview');
    input.value = suggestSubdomain();
    const refresh = () => { const v = subSanitize(input.value) || 'sito'; preview.textContent = 'Sarà online su: ' + v + '.pages.dev'; };
    refresh();
    input.addEventListener('input', refresh);
    const setBtn = ov.querySelector('[data-act="set"]');
    if (setBtn) setBtn.addEventListener('click', () => { close(); openSettings(); });
    const setLegalBtn = ov.querySelector('[data-act="setlegal"]');
    if (setLegalBtn) setLegalBtn.addEventListener('click', () => { close(); openSettings(); });
    ov.querySelector('[data-act="pub"]').addEventListener('click', () => {
      const v = subSanitize(input.value);
      if (!v) { input.focus(); return; }
      runPublish(v);
    });
    input.focus(); input.select();
  }

  function renderLink(online, data) {
    data = data || {};
    const url = data.url || ctx.url || currentUrl || '';
    const title = online ? 'Sito online' : 'Pubblicazione in corso';
    const status = online
      ? 'Il tuo sito è online a questo indirizzo:'
      : '⏳ Sto mettendo online il sito… sarà raggiungibile tra pochi secondi.';
    const deliveryNote = data.deliveryActive === false
      ? '<p class="set-note" style="margin:14px 0 0">⚠ Il modulo è online ma i messaggi non ti arriveranno finché non imposti un’email in Impostazioni e ripubblichi.</p>'
      : '';
    const linkBase = 'display:block;word-break:break-all;color:var(--accent);font-weight:600;font-size:16px;padding:12px 14px;border:1px solid var(--line-2);border-radius:10px;background:var(--panel-2);text-decoration:none;margin-bottom:14px';
    const linkHtml = !url ? ''
      : online
        ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener" data-role="openlink" style="' + linkBase + '">' + escapeHtml(url) + '</a>'
        : '<div data-role="openlink" style="' + linkBase + ';opacity:.55;pointer-events:none">' + escapeHtml(url) + ' <span style="font-weight:400;opacity:.8">· in preparazione</span></div>';
    const shareBtn = (online && navigator.share) ? '<button class="btn accent" data-act="share">Condividi</button>' : '';
    const copyBtn = online ? '<button class="btn" data-act="copy">Copia link</button>' : '';
    const openBtn = online ? '<button class="btn" data-act="open">Apri</button>' : '';
    const closeBtn = online ? '' : '<button class="btn" data-act="close2">Chiudi</button>';
    const tail = online ? '' : '<p class="set-note" style="margin:10px 0 0;opacity:.8">Il link sarà disponibile appena il sito sarà online.</p>';
    shell(title,
      '<p class="set-note" data-role="status" style="margin:0 0 10px">' + status + '</p>' +
      linkHtml +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' + shareBtn + copyBtn + openBtn + closeBtn + '</div>' +
      tail + deliveryNote);
    const copyEl = ov.querySelector('[data-act="copy"]');
    if (copyEl) copyEl.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); }
      catch (e) { try { const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); } catch (e2) { return; } }
      copyEl.textContent = 'Copiato ✓'; setTimeout(() => { copyEl.textContent = 'Copia link'; }, 1600);
    });
    const openEl = ov.querySelector('[data-act="open"]');
    if (openEl) openEl.addEventListener('click', () => { if (online) window.open(url, '_blank', 'noopener'); });
    const shareEl = ov.querySelector('[data-act="share"]');
    if (shareEl) shareEl.addEventListener('click', async () => { if (!online) return; try { await navigator.share({ title: 'Il mio sito', text: 'Dai un’occhiata al mio sito:', url: url }); } catch (e) {} });
    const close2El = ov.querySelector('[data-act="close2"]');
    if (close2El) close2El.addEventListener('click', close);
    // Transizione publishing -> online SOLO dopo conferma del server (finestra di propagazione Cloudflare).
    if (!online && url && data.confirmed) {
      const ACTIVATION_MS = 15000;
      activationTimer = setTimeout(() => { renderLink(true, { url: url, deliveryActive: data.deliveryActive }); }, ACTIVATION_MS);
    }
  }

  function renderError(data) {
    data = data || {};
    const plan = !!data.plan;          // errore di limite-piano al publish
    const planActive = !!data.planActive; // l'account ha già un piano attivo
    const planNext = data.planNext;    // { sites: N } se c'è un tier sopra; null se al massimo
    let title, actions;
    let msg = data.message || 'Si è verificato un errore durante la pubblicazione.';
    if (plan && planActive && planNext && planNext.sites) {
      // pagante al limite → propone l'upgrade al tier superiore
      title = 'Passa al piano superiore';
      msg = 'Hai raggiunto il limite del tuo piano. Passa a ' + planNext.sites + ' siti pubblicati per continuare.';
      actions = '<button class="btn" data-act="close2">Chiudi</button><button class="btn accent" data-act="upgrade">Passa a ' + planNext.sites + ' siti</button>';
    } else if (plan && planActive) {
      // pagante già al tier massimo
      title = 'Sei al piano massimo';
      msg = 'Hai raggiunto il massimo dei siti pubblicabili (30). Scrivici a ciao@thebrik.it per esigenze maggiori.';
      actions = '<button class="btn" data-act="close2">Chiudi</button>';
    } else if (plan) {
      // nessun piano attivo → attiva (checkout BASE)
      title = 'Attiva il piano per pubblicare';
      actions = '<button class="btn" data-act="close2">Chiudi</button><button class="btn accent" data-act="plan">Attiva piano</button>';
    } else {
      title = 'Pubblicazione non riuscita';
      actions = '<button class="btn" data-act="close2">Chiudi</button><button class="btn accent" data-act="retry">Riprova</button>';
    }
    shell(title,
      '<p class="set-note" style="margin:0 0 14px">' + escapeHtml(msg) + '</p>' +
      (data.findings ? '<ul class="tiny" style="margin:0 0 14px;padding-left:18px">' + data.findings + '</ul>' : '') +
      '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">' + actions + '</div>');
    ov.querySelector('[data-act="close2"]').addEventListener('click', close);
    const retryEl = ov.querySelector('[data-act="retry"]');
    if (retryEl) retryEl.addEventListener('click', () => { runPublish(ctx.lastSub); });
    const planEl = ov.querySelector('[data-act="plan"]');
    if (planEl) planEl.addEventListener('click', startCheckout);
    const upEl = ov.querySelector('[data-act="upgrade"]');
    if (upEl) upEl.addEventListener('click', async () => {
      upEl.disabled = true; upEl.textContent = 'Aggiorno il piano…';
      try {
        const r = await api('POST', '/api/projects/' + encodeURIComponent(currentId) + '/upgrade');
        if (r && r.ok) { close(); runPublish(ctx.lastSub); return; }
        upEl.disabled = false; upEl.textContent = 'Passa a ' + (planNext && planNext.sites) + ' siti';
        addMsg('bot', '<p>Upgrade non riuscito.</p><p class="tiny">' + escapeHtml((r && r.error && r.error.message) || '') + '</p>', 'err');
      } catch (e) {
        upEl.disabled = false; upEl.textContent = 'Passa a ' + (planNext && planNext.sites) + ' siti';
        addMsg('bot', "<p>Errore nell'upgrade del piano.</p>", 'err');
      }
    });
  }

  // Rete invariata: stesso endpoint /publish e stesso renderState. Cambia solo la resa (modale a stati).
  async function runPublish(subdomain) {
    ctx.lastSub = subdomain;
    renderLink(false, { url: currentUrl }); // "in corso": copia attiva solo se un URL esiste già (ripubblicazione)
    const data = await api('POST', '/api/projects/' + encodeURIComponent(currentId) + '/publish', subdomain ? { subdomain: subdomain } : {});
    if (!data.ok) {
      if (data.error && data.error.code === 'NEEDS_AUTH') { close(); return; }
      if (data.error && data.error.code === 'SITE_BUILDING') { renderError({ message: 'Il sito è ancora in costruzione: riprova fra qualche secondo.' }); return; }
      if (data.error && data.error.code === 'PLAN_LIMIT_REACHED') { renderError({ message: data.error.message, plan: true, planActive: data.error.planActive, planNext: data.error.planNext }); return; }
      renderError({ message: (data.error && data.error.message) || 'Pubblicazione non riuscita.' });
      return;
    }
    renderState(data);
    if (data.published) {
      const url = data.state.url;
      if (url) {
        const link = '<p><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + escapeHtml(url) + '</a></p>';
        const note = data.deliveryActive === false
          ? '<p class="tiny">Il modulo è online ma i messaggi non verranno recapitati: imposta un’email in <strong>Impostazioni</strong> e ripubblica.</p>'
          : '';
        const cta = '<p class="tiny">Vuoi un indirizzo tuo (es. nomeazienda.it)? <button type="button" class="link-concierge" style="background:none;border:0;color:var(--accent);cursor:pointer;padding:0;font:inherit;text-decoration:underline">Richiedi un dominio ufficiale</button></p>';
        addMsg('bot', '<p>Pubblicato. Sto mettendo online il sito: sarà raggiungibile tra pochi secondi.</p>' + link + note + cta, 'ok-note');
        renderLink(false, { url: url, deliveryActive: data.deliveryActive, confirmed: true });
      } else {
        renderError({ message: 'Pubblicazione completata, ma il server non ha restituito l’indirizzo. Riprova tra poco.' });
      }
    } else {
      const list = (data.findings || []).map((f) => '<li><span class="tiny">' + escapeHtml(f.route) + '</span> ' + escapeHtml(f.severity) + ' · ' + escapeHtml(f.code) + ' ×' + f.count + '</li>').join('');
      renderError({ message: 'Pubblicazione bloccata dal controllo di sicurezza.', findings: list });
    }
  }

  if (initialState === 'idle') renderIdle();
  else if (initialState === 'online') renderLink(true, ctx);
  else renderLink(false, ctx); // publishing (default)
  return { close: close, runPublish: runPublish };
}

function doPublish(subdomain) {
  const m = openSiteModal('publishing', { url: currentUrl });
  return m.runPublish(subdomain);
}

function publish() {
  if (!currentId) return;
  if (currentUrl) return doPublish(); // già pubblicato: riusa il sottodominio scelto
  if (!authUser) { promptAuth('Accedi con la tua email per vedere il tuo sito online: resta salvato e riprendi da qui.'); return; }
  openSiteModal('idle');
}

async function revert() {
  const data = await api('POST', `/api/projects/${encodeURIComponent(currentId)}/revert`);
  if (!data.ok) return addMsg('bot', `<p class="tiny">${escapeHtml(data.error?.message || 'errore')}</p>`, 'err');
  renderState(data);
  loadPreview(currentId, data.state.version);
  addMsg('bot', `<p>Ripristinata la versione precedente (v${data.state.version}).</p>`);
}

async function openProject(id) {
  hideLanding();
  let data = await api('GET', `/api/projects/${encodeURIComponent(id)}`);
  if (!data.ok) return addMsg('bot', `<p class="tiny">${escapeHtml(data.error?.message || 'errore')}</p>`, 'err');
  if (data.gen === 'error') return addMsg('bot', `<p>Non sono riuscito a costruire il sito.</p><p class="tiny">${escapeHtml(data.error?.message || '')}</p>`, 'err');
  if (data.gen === 'generating') {
    // build ancora in corso (es. pagina ricaricata durante la generazione): riprendi il polling
    clearChat(); setProjLabel(id); saveLastProject(id);
    const t = thinking('Sto costruendo la bozza'); setBusy(true, 'Sto costruendo la bozza…'); setMobileView('preview');
    data = await pollUntilReady(id);
    t.remove(); setBusy(false);
    if (!data.ok) { if (data.needsAuth) return; return addMsg('bot', `<p>Non sono riuscito a costruire il sito.</p><p class="tiny">${escapeHtml(data.error?.message || '')}</p>`, 'err'); }
    renderState(data); currentEmail = data.email || ''; currentLegal = data.legal || {}; setProjLabel(id); saveLastProject(id);
    loadPreview(data.state.id, data.state.version); setMobileView('preview');
    addMsg('bot', `<p>Pronto.</p>${summaryHtml(data.summary)}`);
    try {
      if (!authUser && sessionStorage.getItem('brik:pizzeriaProject') === id) {
        sessionStorage.removeItem('brik:pizzeriaProject');
        setTimeout(() => promptAuth('Inserisci la tua email per salvare questa anteprima e riaprirla senza perdere il lavoro.'), 250);
      }
    } catch (e) {}
    return;
  }
  clearChat();
  renderState(data);
  currentEmail = data.email || '';
  currentLegal = data.legal || {};
  setProjLabel(id);
  saveLastProject(id);
  loadPreview(id, data.state.version);
  setMobileView('preview');
  addMsg('bot', `<p>Caricato.</p>${summaryHtml(data.summary)}`);
  try {
    if (!authUser && sessionStorage.getItem('brik:pizzeriaProject') === id) {
      sessionStorage.removeItem('brik:pizzeriaProject');
      setTimeout(() => promptAuth('Inserisci la tua email per salvare questa anteprima e riaprirla senza perdere il lavoro.'), 250);
    }
  } catch (e) {}
}

function resetToNew() {
  currentId = null;
  currentStatus = null;
  intakeActive = false;
  pendingCreate = null;
  input.placeholder = 'Racconta la tua attività…';
  clearAttachments();
  disableSend(false);
  updateComposerMode();
  setProjLabel('');
  setMobileView('chat');
  if (statusPill) statusPill.hidden = true;
  if (versionTag) versionTag.hidden = true;
  const ss = document.getElementById('settingsStatus'); if (ss) ss.textContent = '';
  routesEl.innerHTML = '';
  frame.hidden = true;
  frame.removeAttribute('src');
  placeholder.hidden = false;
  currentEmail = '';
  currentLegal = {};
  currentUrl = '';
  clearLastProject();
  setEditMode(false);
  closeSettings();
  applyStatusButtons();
  clearChat();
  addMsg('bot', '<p>Pronto. Raccontami la tua attività e che sito vuoi.</p>');
  // Da loggato resti dentro l'app con la chat svuotata; la landing pubblica è solo per chi non ha accesso.
  if (authUser) { hideLanding(); setMobileView('chat'); }
  else showLanding();
}

// ---------- landing (hero iniziale) ----------
function showLanding() { try { document.body.classList.add('has-landing'); } catch (e) {} }
function hideLanding() { try { document.body.classList.remove('has-landing'); } catch (e) {} }
function startFromLanding(text) {
  const t = (text || '').trim();
  if (!t) return;
  hideLanding();
  setMobileView('chat');
  beginCreate(t, [], [], []);
}
if (landingForm) landingForm.addEventListener('submit', (e) => { e.preventDefault(); startFromLanding(landingInput && landingInput.value); });
if (landingInput) landingInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startFromLanding(landingInput.value); } });
let _promptBeaconSent = false;
function sendPromptBeacon() {
  if (_promptBeaconSent) return; _promptBeaconSent = true;
  try {
    const payload = JSON.stringify({ name: 'promptStarted' });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/ev', new Blob([payload], { type: 'application/json' }));
    else fetch('/api/ev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true });
  } catch (e) {}
}
if (landingInput) landingInput.addEventListener('input', () => { if ((landingInput.value || '').trim().length >= 3) sendPromptBeacon(); });
if (landingChips) landingChips.addEventListener('click', (e) => {
  const b = e.target && e.target.closest ? e.target.closest('.landing-chip') : null;
  if (!b || !landingInput) return;
  landingInput.value = b.textContent.trim();
  try { landingInput.focus(); } catch (err) {}
});

// ---------- eventi ----------
let composerFocused = false;
const composerEl = $('composer');
function updateComposerMode() {
  const expanded = composerFocused || input.value.trim().length > 0 || attachments.length > 0;
  composerEl.classList.toggle('expanded', expanded);
}
function autoGrow() {
  input.style.height = 'auto';
  const mobile = window.matchMedia('(max-width: 820px)').matches;
  const cap = mobile ? Math.max(90, Math.round(window.innerHeight * 0.30)) : Math.max(140, Math.round(window.innerHeight * 0.45));
  const focusMin = (composerFocused && !mobile) ? Math.min(cap, 200) : 0;
  input.style.height = Math.max(focusMin, Math.min(input.scrollHeight, cap)) + 'px';
}

// ---------- allegati (fase TESTO) ----------
// Allegati disponibili sempre: in create alimentano la prima bozza, in modifica il rigenero della pagina.
function attachEnabled() { return true; }

function fileIconSvg(kind) {
  if (kind === 'pdf') return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  if (kind === 'docx') return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';
  return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>';
}
function fmtChars(n) {
  if (n >= 1000) { const k = n / 1000; return (k >= 10 ? Math.round(k) : k.toFixed(1).replace('.0', '')) + 'k caratteri'; }
  return n + ' caratteri';
}
function metaFor(a) {
  if (a.status === 'loading') return a.type === 'image' ? 'ridimensiono…' : 'leggo…';
  if (a.status === 'error') return a.error || 'errore';
  if (a.status === 'empty') return a.error || 'nessun testo';
  if (a.type === 'image') return 'foto';
  return fmtChars(a.chars || 0) + (a.truncated ? ' · tagliato' : '');
}
function imageIconSvg() {
  return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>';
}

function renderAttachments() {
  if (!attachList) return;
  attachList.textContent = '';
  if (!attachments.length) { attachList.hidden = true; return; }
  attachList.hidden = false;
  for (const a of attachments) {
    const chip = document.createElement('div');
    chip.className = 'attach-chip' + (a.type === 'image' ? ' is-image' : '') + (a.status === 'error' ? ' is-error' : a.status === 'empty' ? ' is-empty' : a.status === 'loading' ? ' is-loading' : '');
    const ic = document.createElement('span');
    ic.className = 'ac-ic';
    if (a.type === 'image' && a.status === 'ready' && a.thumbUrl) {
      const im = document.createElement('img');
      im.className = 'ac-thumb';
      im.src = a.thumbUrl;
      im.alt = '';
      ic.appendChild(im);
    } else {
      ic.innerHTML = a.status === 'loading' ? '<span class="ac-spin"></span>' : (a.type === 'image' ? imageIconSvg() : fileIconSvg(a.kind));
    }
    const nm = document.createElement('span');
    nm.className = 'ac-name';
    nm.textContent = a.name;
    nm.title = a.name;
    const mt = document.createElement('span');
    mt.className = 'ac-meta';
    mt.textContent = metaFor(a);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'ac-x';
    x.setAttribute('aria-label', 'Rimuovi ' + a.name);
    x.textContent = '✕';
    x.addEventListener('click', () => removeAttachment(a.id));
    chip.append(ic, nm, mt, x);
    attachList.appendChild(chip);
  }
}
function removeAttachment(id) { attachments = attachments.filter((a) => a.id !== id); renderAttachments(); updateComposerMode(); }
function clearAttachments() { attachments = []; renderAttachments(); }
function readySources() { return attachments.filter((a) => a.status === 'ready' && a.type !== 'image' && a.text).map((a) => ({ name: a.name, text: a.text })); }
function readyImages() { return attachments.filter((a) => a.status === 'ready' && a.type === 'image' && a.dataBase64).map((a) => ({ name: a.name, mime: a.mime, dataBase64: a.dataBase64, alt: (a.alt && a.alt.trim()) || filenameToAlt(a.name) })); }
function filenameToAlt(name) { return String(name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); }
function isImageFile(file) { return (file.type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name || ''); }

let attachNoteTimer = null;
function flashAttachNote(msg) {
  if (!attachList) return;
  attachList.hidden = false;
  let note = attachList.querySelector('.attach-note');
  if (!note) { note = document.createElement('div'); note.className = 'attach-note'; attachList.appendChild(note); }
  note.textContent = msg;
  clearTimeout(attachNoteTimer);
  attachNoteTimer = setTimeout(() => { if (note) note.remove(); if (!attachments.length) attachList.hidden = true; }, 2600);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(new Error('lettura fallita'));
    r.readAsDataURL(file);
  });
}
async function ingestOne(item, file) {
  try {
    const dataBase64 = await fileToBase64(file);
    const data = await api('POST', '/api/ingest', { name: file.name, mime: file.type || '', dataBase64 });
    if (!data || !data.ok) { item.status = 'error'; item.error = (data && data.error && data.error.message) || 'estrazione fallita'; }
    else if (data.empty || !data.text) { item.status = 'empty'; item.error = 'nessun testo (forse è una scansione)'; }
    else { item.status = 'ready'; item.text = data.text; item.chars = data.chars; item.truncated = !!data.truncated; item.kind = data.kind; }
  } catch (_e) {
    item.status = 'error'; item.error = 'lettura fallita';
  }
  renderAttachments();
}
// Ridimensiona la foto nel browser (lato leggero per upload e pagina): max lato 1600px, JPEG ~0.82.
const MAX_IMG_DIM = 1600;
function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) { URL.revokeObjectURL(url); reject(new Error('vuota')); return; }
        const scale = Math.min(1, MAX_IMG_DIM / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const keepPng = file.type === 'image/png' && file.size < 350 * 1024; // logo piccolo: mantieni trasparenza
        const mime = keepPng ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(mime, 0.82);
        resolve({ mime, dataUrl });
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('non leggibile')); };
    img.src = url;
  });
}
async function ingestImage(item, file) {
  try {
    const { mime, dataUrl } = await downscaleImage(file);
    item.mime = mime;
    item.dataBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    item.thumbUrl = dataUrl;
    item.status = 'ready';
  } catch (_e) {
    item.status = 'error'; item.error = 'immagine non leggibile';
  }
  renderAttachments();
}
function addFiles(fileList) {
  if (!attachEnabled()) return;
  const files = Array.from(fileList || []);
  for (const file of files) {
    if (attachments.length >= MAX_ATTACH) { flashAttachNote('Massimo ' + MAX_ATTACH + ' allegati.'); break; }
    const image = isImageFile(file);
    if (file.size > MAX_FILE_BYTES) {
      attachments.push({ id: ++attachSeq, name: file.name, type: image ? 'image' : 'text', status: 'error', error: 'troppo grande (max 16MB)' });
      continue;
    }
    if (image) {
      const item = { id: ++attachSeq, name: file.name, type: 'image', status: 'loading' };
      attachments.push(item);
      ingestImage(item, file);
    } else {
      const item = { id: ++attachSeq, name: file.name, type: 'text', status: 'loading', text: '', chars: 0, truncated: false };
      attachments.push(item);
      ingestOne(item, file);
    }
  }
  renderAttachments();
  updateComposerMode();
}

// --- Cartella di foto (quick win, fino a MAX_ATTACH) -------------------------
// Da picker (webkitdirectory) o da drag&drop di una cartella: prende SOLO le immagini,
// le ordina per nome (naturale) e ne aggiunge fino al tetto. Riusa la pipeline esistente.
function addImageFilesFromFolder(fileList) {
  if (!attachEnabled()) return;
  const imgs = Array.from(fileList || [])
    .filter(isImageFile)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
  if (!imgs.length) { flashAttachNote('Nessuna foto trovata nella cartella.'); return; }
  const room = MAX_ATTACH - attachments.length;
  if (room <= 0) { flashAttachNote('Massimo ' + MAX_ATTACH + ' allegati.'); return; }
  const take = imgs.slice(0, room);
  addFiles(take);
  if (imgs.length > take.length) flashAttachNote('Cartella: aggiunte ' + take.length + ' foto su ' + imgs.length + ' (limite ' + MAX_ATTACH + ').');
}

let folderInput = null;
function ensureFolderInput() {
  if (folderInput) return folderInput;
  folderInput = document.createElement('input');
  folderInput.type = 'file';
  folderInput.multiple = true;
  folderInput.webkitdirectory = true;
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.setAttribute('directory', '');
  folderInput.style.display = 'none';
  folderInput.addEventListener('change', () => { addImageFilesFromFolder(folderInput.files); folderInput.value = ''; });
  document.body.appendChild(folderInput);
  return folderInput;
}
function pickFolder() { ensureFolderInput().click(); }

// Legge ricorsivamente una FileSystemEntry (file o cartella) raccogliendo i File.
// readEntries va richiamato finche non restituisce un batch vuoto.
function readEntry(entry, out) {
  return new Promise((resolve) => {
    if (!entry) return resolve();
    if (entry.isFile) {
      entry.file((f) => { out.push(f); resolve(); }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readBatch = () => reader.readEntries(async (ents) => {
        if (!ents || !ents.length) return resolve();
        for (const e of ents) { try { await readEntry(e, out); } catch {} }
        readBatch();
      }, () => resolve());
      readBatch();
    } else resolve();
  });
}

const IMG_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif';
const DOC_ACCEPT = '.txt,.md,.markdown,.csv,.pdf,.docx,text/plain,text/markdown,text/csv,application/pdf,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function pickFiles(accept) { if (!fileInput) return; fileInput.accept = accept; fileInput.click(); }
function closeAttachMenu() { const m = document.getElementById('attachMenu'); if (m) m.remove(); }
function openAttachMenu() {
  if (!attachEnabled() || !attachBtn) return;
  if (document.getElementById('attachMenu')) { closeAttachMenu(); return; }
  const menu = document.createElement('div');
  menu.id = 'attachMenu';
  menu.className = 'attach-menu';
  menu.innerHTML =
    '<button type="button" data-act="image"><span class="am-ic">🖼</span> Immagine</button>' +
    '<button type="button" data-act="folder"><span class="am-ic">📁</span> Cartella di foto</button>' +
    '<button type="button" data-act="file"><span class="am-ic">📄</span> File o documento</button>' +
    '<button type="button" data-act="url"><span class="am-ic">🔗</span> Da un sito (URL)</button>';
  document.body.appendChild(menu);
  const r = attachBtn.getBoundingClientRect();
  let left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8));
  let top = r.top - menu.offsetHeight - 8;
  if (top < 8) top = r.bottom + 8;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  const close = () => { menu.remove(); document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('keydown', onKey, true); };
  const onDoc = (e) => { if (!menu.contains(e.target) && e.target !== attachBtn) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  setTimeout(() => { document.addEventListener('mousedown', onDoc, true); document.addEventListener('keydown', onKey, true); }, 0);
  menu.querySelector('[data-act="image"]').addEventListener('click', () => { close(); pickFiles(IMG_ACCEPT); });
  menu.querySelector('[data-act="folder"]').addEventListener('click', () => { close(); pickFolder(); });
  menu.querySelector('[data-act="file"]').addEventListener('click', () => { close(); pickFiles(DOC_ACCEPT); });
  menu.querySelector('[data-act="url"]').addEventListener('click', () => { close(); openImportPanel(); });
}

if (attachBtn && fileInput) {
  attachBtn.addEventListener('click', () => { if (attachEnabled()) openAttachMenu(); });
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => composerEl.addEventListener(ev, (e) => {
    if (!attachEnabled()) return;
    e.preventDefault(); composerEl.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((ev) => composerEl.addEventListener(ev, (e) => {
    if (ev === 'dragleave' && e.target !== composerEl) return;
    composerEl.classList.remove('dragging');
  }));
  composerEl.addEventListener('drop', async (e) => {
    if (!attachEnabled()) return;
    e.preventDefault();
    const dt = e.dataTransfer;
    if (!dt) return;
    // catturo SUBITO (la DataTransfer non e piu valida dopo un await)
    const plainFiles = dt.files && dt.files.length ? Array.from(dt.files) : [];
    const entries = dt.items ? Array.from(dt.items).map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean) : [];
    const hasDir = entries.some((en) => en && en.isDirectory);
    if (hasDir) {
      const out = [];
      for (const en of entries) { try { await readEntry(en, out); } catch {} }
      addImageFilesFromFolder(out);
      return;
    }
    if (plainFiles.length) addFiles(plainFiles);
  });
}

// ---------- import da URL ----------
function imgExt(mime) { return mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : mime === 'image/gif' ? '.gif' : '.jpg'; }
function urlToName(url) {
  try { const u = new URL(url); const seg = (u.pathname.split('/').filter(Boolean).pop() || u.hostname); return decodeURIComponent(seg).replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'immagine'; }
  catch { return 'immagine'; }
}
function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || 'image/jpeg' });
}
async function importImageFromUrl(url, alt) {
  if (attachments.length >= MAX_ATTACH) { flashAttachNote('Massimo ' + MAX_ATTACH + ' allegati.'); return; }
  const name = (alt && alt.trim()) || urlToName(url);
  const item = { id: ++attachSeq, name, type: 'image', status: 'loading', ...(alt && alt.trim() ? { alt: alt.trim() } : {}) };
  attachments.push(item);
  renderAttachments();
  updateComposerMode();
  try {
    const data = await api('POST', '/api/fetch-image', { url });
    if (!data || !data.ok) throw new Error('fetch');
    const file = new File([base64ToBlob(data.dataBase64, data.mime)], name + imgExt(data.mime), { type: data.mime });
    await ingestImage(item, file);
  } catch (_e) {
    item.status = 'error'; item.error = 'non scaricabile'; renderAttachments();
  }
}
function addImportedText(host, text) {
  if (attachments.length >= MAX_ATTACH) { flashAttachNote('Massimo ' + MAX_ATTACH + ' allegati.'); return; }
  attachments.push({ id: ++attachSeq, name: host || 'sito', type: 'text', status: 'ready', text, chars: (text || '').length, truncated: false, kind: 'text' });
  renderAttachments();
}
function renderImportResult(ov, data, close) {
  const inputView = ov.querySelector('[data-view="input"]');
  const resultView = ov.querySelector('[data-view="result"]');
  inputView.hidden = true;
  resultView.hidden = false;
  let host = data.url;
  try { host = new URL(data.url).hostname.replace(/^www\./, ''); } catch (_e) {}
  ov.querySelector('.modal-head h3').textContent = 'Importa da ' + host;
  const hasText = !!(data.text && data.text.trim());
  const imgs = Array.isArray(data.images) ? data.images : [];
  const preview = hasText ? escapeHtml(data.text.slice(0, 280)) + (data.text.length > 280 ? '…' : '') : '';
  resultView.innerHTML =
    (hasText
      ? '<label class="imp-text"><input type="checkbox" id="impText" checked> <span>Includi il testo <span class="tiny">(' + data.chars + ' caratteri)</span></span></label><div class="imp-preview tiny">' + preview + '</div>'
      : '<p class="tiny">Nessun testo rilevato.</p>') +
    (imgs.length
      ? '<div class="imp-imgs-head"><span>Immagini (' + imgs.length + ')</span><span class="tiny"><button class="linklike" data-act="all">tutte</button> · <button class="linklike" data-act="none">nessuna</button></span></div><div class="imp-grid"></div>'
      : '<p class="tiny">Nessuna immagine trovata.</p>') +
    '<div class="imp-actions"><button class="btn ghost" data-act="cancel">Annulla</button><button class="btn accent" data-act="import">Importa selezionati</button></div>';
  const grid = resultView.querySelector('.imp-grid');
  const selected = new Set();
  if (grid) imgs.forEach((im, i) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'imp-tile selected';
    tile.dataset.i = String(i);
    const t = document.createElement('img');
    t.src = im.url; t.alt = im.alt || ''; t.loading = 'lazy';
    t.onerror = () => { tile.classList.add('broken'); tile.classList.remove('selected'); selected.delete(i); tile.disabled = true; };
    const ck = document.createElement('span'); ck.className = 'imp-check'; ck.textContent = '✓';
    tile.append(t, ck);
    selected.add(i);
    tile.addEventListener('click', () => { if (tile.classList.toggle('selected')) selected.add(i); else selected.delete(i); });
    grid.appendChild(tile);
  });
  const all = resultView.querySelector('[data-act="all"]');
  const none = resultView.querySelector('[data-act="none"]');
  if (all && grid) all.addEventListener('click', () => grid.querySelectorAll('.imp-tile:not(.broken)').forEach((t) => { t.classList.add('selected'); selected.add(Number(t.dataset.i)); }));
  if (none && grid) none.addEventListener('click', () => grid.querySelectorAll('.imp-tile').forEach((t) => { t.classList.remove('selected'); selected.delete(Number(t.dataset.i)); }));
  resultView.querySelector('[data-act="cancel"]').addEventListener('click', close);
  resultView.querySelector('[data-act="import"]').addEventListener('click', () => {
    const includeText = hasText && !!(resultView.querySelector('#impText') && resultView.querySelector('#impText').checked);
    const chosen = imgs.filter((_im, i) => selected.has(i));
    if (includeText) addImportedText(host, data.text);
    chosen.forEach((im) => importImageFromUrl(im.url, im.alt));
    close();
    updateComposerMode();
    flashAttachNote('Importati' + (includeText ? ' testo' : '') + (includeText && chosen.length ? ' +' : '') + (chosen.length ? ' ' + chosen.length + ' foto' : '') + '. Ora scrivi e invia.');
  });
}
function openImportPanel() {
  if (!attachEnabled()) return;
  const ov = document.createElement('div');
  ov.className = 'modal';
  ov.innerHTML =
    '<div class="modal-card import-card">' +
    '<div class="modal-head"><h3>Importa da un sito</h3><button class="icon-btn" data-act="close" aria-label="Chiudi">×</button></div>' +
    '<div data-view="input">' +
    '<p class="set-note" style="margin:0 0 10px">Incolla l\'indirizzo di un sito esistente: prendo testi e immagini, poi scegli tu cosa importare.</p>' +
    '<div class="imp-url"><input id="impUrl" class="text-input" type="text" placeholder="https://… oppure nomeazienda.it" spellcheck="false" autocapitalize="off" /><button class="btn accent" data-act="read">Leggi</button></div>' +
    '<p class="imp-status tiny" hidden></p>' +
    '</div>' +
    '<div data-view="result" hidden></div>' +
    '</div>';
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-act="close"]').addEventListener('click', close);
  const urlInput = ov.querySelector('#impUrl');
  const statusEl = ov.querySelector('.imp-status');
  const readBtn = ov.querySelector('[data-act="read"]');
  const doRead = async () => {
    const url = urlInput.value.trim();
    if (!url) { urlInput.focus(); return; }
    statusEl.hidden = false; statusEl.textContent = 'Leggo il sito… (se è fatto in JavaScript può volerci qualche secondo)'; readBtn.disabled = true;
    const data = await api('POST', '/api/import', { url });
    readBtn.disabled = false;
    if (!data || !data.ok) { statusEl.textContent = (data && data.error && data.error.message) || 'Non riuscito.'; return; }
    renderImportResult(ov, data, close);
  };
  readBtn.addEventListener('click', doRead);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doRead(); } });
  urlInput.focus();
}
$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || sendBtn.disabled) return;
  if (attachments.some((a) => a.status === 'loading')) { flashAttachNote('Sto ancora leggendo un allegato, un attimo…'); return; }
  const sources = readySources();
  const images = readyImages();
  const attachedNames = attachments.filter((a) => a.status === 'ready').map((a) => ({ name: a.name, image: a.type === 'image' }));
  input.value = '';
  composerFocused = false;
  input.style.height = '';
  updateComposerMode();
  if (currentId) editSite(text, sources, images, attachedNames);
  else beginCreate(text, sources, images, attachedNames);
});

input.addEventListener('input', () => { updateComposerMode(); autoGrow(); });
input.addEventListener('focus', () => { composerFocused = true; updateComposerMode(); autoGrow(); });
input.addEventListener('blur', () => { composerFocused = false; updateComposerMode(); autoGrow(); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('composer').requestSubmit();
  }
});

// Dettatura vocale (Web Speech API del browser; Brave/Chrome desktop e Android).
// Su iPhone/iPad questa API non funziona: si usa il microfono della tastiera di sistema.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const micBtn = $('micBtn');
if (SR && micBtn && !isIOS) {
  micBtn.hidden = false;
  let recog = null, recording = false, baseText = '';
  micBtn.addEventListener('click', () => {
    if (sendBtn.disabled) return;
    if (recording) { if (recog) recog.stop(); return; }
    recog = new SR();
    recog.lang = 'it-IT';
    recog.interimResults = true;
    recog.continuous = true;
    baseText = input.value.trim();
    recog.onresult = (e) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      input.value = (baseText ? baseText + ' ' : '') + t;
      updateComposerMode();
      autoGrow();
    };
    const stop = () => { recording = false; micBtn.classList.remove('rec'); };
    recog.onend = stop;
    recog.onerror = stop;
    try { recog.start(); recording = true; micBtn.classList.add('rec'); }
    catch { stop(); }
  });
}

$('newBtn').addEventListener('click', resetToNew);
if (projBtn) projBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleProjMenu(); });
publishBtn.addEventListener('click', publish);
revertBtn.addEventListener('click', revert);

if (editBtn) editBtn.addEventListener('click', () => { if (currentId) setEditMode(!editMode); });
(function () {
  const a = document.getElementById('addSectionTop');
  if (a) a.addEventListener('click', () => openSectionPicker());
  // La barra di scrittura si apre grande (con lo storico) quando ci scrivi dentro,
  // e resta piccola da chiusa per dare il massimo spazio alle modifiche sul sito.
  if (askInput) {
    askInput.addEventListener('focus', () => {
      const ab = document.getElementById('askbar');
      if (ab) ab.classList.add('open');
      syncAskLog();
    });
  }
  (function () {
    const c = document.getElementById('askCollapse');
    if (c) c.addEventListener('click', () => {
      const ab = document.getElementById('askbar');
      if (ab) ab.classList.remove('open');
      if (askInput) askInput.blur();
    });
  })();
})();
if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
if (settingsClose) settingsClose.addEventListener('click', closeSettings);
if (settings) settings.addEventListener('click', (e) => { if (e.target === settings) closeSettings(); });
if (emailSave) emailSave.addEventListener('click', saveEmail);
if (legalSave) legalSave.addEventListener('click', saveLegal);
if (settingsSave) settingsSave.addEventListener('click', saveAllSettings);
if (addrSave) addrSave.addEventListener('click', changeAddress);
if (ownerAddrInput) ownerAddrInput.addEventListener('input', refreshAddrNote);
if (conciergeBtn) conciergeBtn.addEventListener('click', openConciergeDialog);
if (messages) messages.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.link-concierge')) openConciergeDialog(); });
if (mobileTabs) mobileTabs.querySelectorAll('.mtab').forEach((b) => b.addEventListener('click', () => setMobileView(b.dataset.view)));
if (themeSelect) themeSelect.addEventListener('change', () => applyTheme(themeSelect.value, currentAccent));
if (accentColor) {
  accentColor.addEventListener('input', () => { currentAccent = accentColor.value; markActiveSwatch(); });
  accentColor.addEventListener('change', () => applyTheme(null, accentColor.value));
}

// Ad ogni (ri)caricamento dell'anteprima: aggiorna rotta/tema/accento e, se attiva, riaggancia la modifica.
frame.addEventListener('load', () => {
  hideCtx();
  if (!currentId) return;
  currentRoute = routeFromFrame();
  markActiveRoute();
  readThemeAccent();
  if (editMode) attachEdit();
});

// chiudi i menu cliccando altrove
document.addEventListener('click', () => {
  const m = routesEl.querySelector('.routes-menu');
  if (m && !m.hidden) m.hidden = true;
  if (projMenu && !projMenu.hidden) closeProjMenu();
});

// ---------- dashboard attività (punto 4) ----------
function statusLabelFor(s) {
  return s === 'preview' ? 'bozza' : s === 'approved' ? 'approvato' : s === 'locked' ? 'in pausa' : s === 'published' ? 'pubblicato' : (s || '');
}
function trialLabelFor(p) {
  if (!p) return '';
  if (p.status === 'locked') return '';
  if (p.entitled) return 'attivo';
  const parts = [];
  if (p.trialPhase === 'trial' && p.trialDaysLeft != null) parts.push(p.trialDaysLeft + 'g');
  if (p.editCap > 0 && p.editsLeft != null) parts.push(p.editsLeft + '/' + p.editCap + ' mod.');
  return parts.length ? 'prova · ' + parts.join(' · ') : '';
}
async function openActivity() {
  const old = document.getElementById('activityOverlay');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'activityOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow:auto;';
  ov.innerHTML = '<div style="background:#fff;color:#111;max-width:720px;width:100%;border-radius:14px;padding:18px 20px;box-shadow:0 20px 60px rgba(0,0,0,.3);"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"><strong style="font-size:18px;">Dashboard</strong><button id="activityClose" type="button" style="border:0;background:#eee;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:15px;">✕</button></div><div id="activityBody"><p style="color:#666;">Carico…</p></div></div>';
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  const cb = ov.querySelector('#activityClose'); if (cb) cb.onclick = close;
  const body = ov.querySelector('#activityBody');
  let data;
  try { data = await api('GET', '/api/activity'); } catch { data = null; }
  if (!data || !data.ok) { body.innerHTML = '<p style="color:#b00;">Impossibile caricare l\'attività.</p>'; return; }
  const projects = data.projects || [];
  const reqs = data.domainRequests || [];
  const fmtDate = (s) => { try { return s ? new Date(s).toLocaleDateString('it-IT') : ''; } catch { return ''; } };
  const siteCards = projects.length ? projects.map((p) => {
    const tl = trialLabelFor(p);
    const url = p.url
      ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener" style="color:#2a8a5f;text-decoration:none;">${escapeHtml(String(p.url).replace(/^https?:\/\//, ''))} ↗</a>`
      : '<span style="color:#999;">non pubblicato</span>';
    return `<div style="border-top:1px solid #eee;padding:10px 2px;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">
        <strong style="font-size:15px;">${escapeHtml(p.title || p.id)}</strong>
        <span style="font-size:12px;color:#999;white-space:nowrap;">${escapeHtml(fmtDate(p.updatedAt))}</span>
      </div>
      <div style="font-size:13px;color:#555;margin-top:3px;">${escapeHtml(statusLabelFor(p.status))}${tl ? ' · ' + escapeHtml(tl) : ''}${p.owner ? ' · ' + escapeHtml(p.owner) : ''}</div>
      <div style="font-size:13px;margin-top:3px;">${url}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        ${p.entitled ? '<span style="font-size:11px;font-weight:700;color:#1c7a4a;background:#e3f6ec;border-radius:6px;padding:2px 8px;">GRATIS ATTIVO</span>' : ''}
        <button data-entitle-id="${escapeHtml(p.id)}" data-entitle-val="${p.entitled ? '0' : '1'}" type="button" style="border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;font-weight:600;${p.entitled ? 'background:#f1d6d6;color:#9b2c2c;' : 'background:#1c7a4a;color:#fff;'}">${p.entitled ? 'Disattiva gratis' : 'Attiva gratis'}</button>
        <button data-chat-id="${escapeHtml(p.id)}" data-chat-title="${escapeHtml(p.title || p.id)}" type="button" style="border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;font-weight:600;background:#e7e7ee;color:#333;">💬 Chat</button>
        ${(!p.entitled && p.status !== 'locked' && p.trialEndsAt && new Date(p.trialEndsAt) < new Date()) ? `<button data-pause-id="${escapeHtml(p.id)}" type="button" style="border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;font-weight:600;background:#fde8c8;color:#8a5a12;">⏸ Metti in pausa</button>` : ''}
      </div>
    </div>`;
  }).join('') : '<p style="color:#999;padding:8px 2px;">Nessun sito ancora.</p>';
  const reqCards = reqs.length ? reqs.map((q) => `<div style="border-top:1px solid #eee;padding:10px 2px;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">
        <strong style="font-size:15px;">${escapeHtml(q.desiredDomain || '')}</strong>
        <span style="font-size:12px;color:#999;white-space:nowrap;">${escapeHtml(fmtDate(q.at))}</span>
      </div>
      <div style="font-size:13px;color:#555;margin-top:3px;">${escapeHtml(q.siteTitle || q.id || '')}</div>
      <div style="font-size:13px;color:#555;margin-top:3px;">${escapeHtml((q.contactName || '') + (q.contactEmail ? ' · ' + q.contactEmail : '') + (q.phone ? ' · ' + q.phone : ''))}</div>
    </div>`).join('') : '<p style="color:#999;padding:8px 2px;">Nessuna richiesta dominio.</p>';
  const st = data.stats || {};
  const free = data.freeAccounts || [];
  const statCard = (label, val, id) => `<div${id ? ` id="${id}"` : ''} style="flex:1;min-width:84px;background:#f6f6f8;border-radius:10px;padding:10px 12px;${id ? 'cursor:pointer;' : ''}"><div style="font-size:22px;font-weight:700;color:#111;">${val}</div><div style="font-size:10.5px;color:#777;text-transform:uppercase;letter-spacing:.04em;margin-top:2px;">${label}${id ? ' ›' : ''}</div></div>`;
  const statsRow = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">${statCard('Utenti', st.users ?? 0, 'statUsers')}${statCard('Siti creati', st.sitesCreated ?? 0)}${statCard('Pubblicati', st.sitesPublished ?? 0)}${statCard('Modifiche', st.totalEdits ?? 0)}${statCard('Media/sito', st.avgEdits ?? 0)}</div>`;
  const sec = (label, n) => `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#999;margin:18px 0 2px;">${label}${n != null ? ' (' + n + ')' : ''}</div>`;
  const freeRows = free.length ? free.map((f) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid #eee;padding:8px 2px;"><span style="font-size:14px;">${escapeHtml(f.email)} <span style="color:#999;font-size:12px;">· ${f.sites} sit${f.sites === 1 ? 'o' : 'i'}</span></span><button data-free-rm="${escapeHtml(f.email)}" type="button" style="border:0;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;font-weight:600;background:#f1d6d6;color:#9b2c2c;">Disattiva</button></div>`).join('') : '<p style="color:#999;padding:6px 2px;">Nessun account gratis.</p>';
  const freeAdd = `<div style="display:flex;gap:6px;margin-top:8px;"><input id="freeEmailInput" type="email" placeholder="email@esempio.it" style="flex:1;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-size:14px;"><button id="freeAddBtn" type="button" style="border:0;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:13px;font-weight:600;background:#1c7a4a;color:#fff;">Attiva gratis</button></div>`;
  const invites = data.invites || [];
  const fmtExp = (ms) => { try { return new Date(ms).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const inviteRows = invites.length ? invites.map((v) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid #eee;padding:8px 2px;"><span style="font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;"><span style="font-family:monospace;">…${escapeHtml(String(v.token).slice(-6))}</span> <span style="color:#999;">· scade ${escapeHtml(fmtExp(v.expiresAt))} · ${v.redeemed} riscatt${v.redeemed === 1 ? 'o' : 'i'}</span></span><span style="display:flex;gap:6px;white-space:nowrap;"><button data-inv-copy="${escapeHtml(v.url)}" type="button" style="border:0;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;font-weight:600;background:#e7e7ee;color:#333;">Copia</button><button data-inv-rm="${escapeHtml(v.token)}" type="button" style="border:0;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;font-weight:600;background:#f1d6d6;color:#9b2c2c;">Disattiva</button></span></div>`).join('') : '<p style="color:#999;padding:6px 2px;">Nessun link attivo.</p>';
  const inviteGen = `<div style="display:flex;gap:6px;margin-top:8px;align-items:center;"><select id="inviteDur" style="border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-size:14px;background:#fff;"><option value="24">24 ore</option><option value="72">3 giorni</option><option value="168">7 giorni</option><option value="720">30 giorni</option></select><button id="inviteGenBtn" type="button" style="border:0;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:13px;font-weight:600;background:#5b5bf0;color:#fff;">Genera link</button></div><div id="inviteOut" style="display:none;margin-top:8px;"></div>`;
  const g = data.guests || {};
  const guestBlock = sec('Ospiti (pre-login)') + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">${statCard('Ospiti totali', g.total || 0)}${statCard('Hanno creato', g.created || 0)}${statCard('Nuovi 7gg', g.new7 || 0)}${statCard('Siti ospite', g.sites || 0)}${statCard('Conversione', (g.conversion || 0) + '%')}</div><p style="color:#999;font-size:11.5px;margin:6px 2px 0;">Un ospite conta dal primo tentativo di creazione. Conversione = registrati ÷ ospiti che hanno creato.</p>`;
  const andamento = sec('Andamento') + `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0 4px;"><select id="rangeSel" style="border:1px solid #ddd;border-radius:8px;padding:7px 9px;font-size:13px;background:#fff;"><option value="today">Oggi</option><option value="24h">Ultime 24h</option><option value="3d">Ultimi 3 giorni</option><option value="7d" selected>Ultimi 7 giorni</option><option value="30d">Ultimi 30 giorni</option><option value="90d">Ultimi 90 giorni</option><option value="day">Giorno specifico…</option></select><input id="rangeDay" type="date" style="display:none;border:1px solid #ddd;border-radius:8px;padding:6px 9px;font-size:13px;" /></div><div id="andamentoBody"><p style="color:#999;padding:6px 2px;">Carico…</p></div>`;
  const staff = data.staff || [];
  const staffRows = staff.length ? staff.map((e) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid #eee;padding:8px 2px;"><span style="font-size:14px;">${escapeHtml(e)}</span><button data-staff-rm="${escapeHtml(e)}" type="button" style="border:0;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;font-weight:600;background:#f1d6d6;color:#9b2c2c;">Rimuovi</button></div>`).join('') : '<p style="color:#999;padding:6px 2px;">Nessuno staff.</p>';
  const staffAdd = `<div style="display:flex;gap:6px;margin-top:8px;"><input id="staffEmailInput" type="email" placeholder="email@staff.it" style="flex:1;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-size:14px;"><button id="staffAddBtn" type="button" style="border:0;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:13px;font-weight:600;background:#5b5bf0;color:#fff;">Aggiungi</button></div><p style="color:#999;font-size:11.5px;margin:6px 2px 0;">Lo staff accede alla dashboard e riceve via email le richieste di dominio.</p>`;
  const staffBlock = (authUser && authUser.isAdmin) ? (sec('Staff', staff.length) + staffRows + staffAdd) : '';
  const fb = data.feedback || [];
  const fmtDT = (s) => { try { return s ? new Date(s).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; } catch { return ''; } };
  const fbRows = fb.length ? fb.map((x) => `<div style="border-top:1px solid #eee;padding:8px 2px;"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;"><span style="font-size:13.5px;">${escapeHtml(x.text || '')}</span><button data-fb-rm="${escapeHtml(x.id)}" type="button" style="flex:none;border:0;border-radius:8px;padding:4px 9px;cursor:pointer;font-size:12px;font-weight:600;background:#e7e7ee;color:#333;">Fatto</button></div><div style="font-size:11.5px;color:#999;margin-top:3px;">${escapeHtml(fmtDT(x.at))}${x.email ? ' · ' + escapeHtml(x.email) : ''}</div></div>`).join('') : '<p style="color:#999;padding:6px 2px;">Nessuna richiesta non soddisfatta.</p>';
  const feedbackBlock = sec('Richieste non soddisfatte', fb.length) + fbRows + `<p style="color:#999;font-size:11.5px;margin:6px 2px 0;">Modifiche chieste in chat ma non applicate: cosa vorrebbero e non riusciamo (ancora) a fare.</p>`;
  body.innerHTML =
    statsRow +
    guestBlock +
    andamento +
    feedbackBlock +
    sec('Account gratis', free.length) + freeRows + freeAdd +
    sec('Link di accesso gratuito', invites.length) + inviteRows + inviteGen +
    staffBlock +
    sec('Siti', projects.length) + siteCards +
    sec('Richieste dominio', reqs.length) + reqCards;
  body.querySelectorAll('[data-entitle-id]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-entitle-id');
      const value = btn.getAttribute('data-entitle-val') === '1';
      btn.disabled = true; const prev = btn.textContent; btn.textContent = '…';
      const r = await api('POST', `/api/projects/${encodeURIComponent(id)}/entitle`, { value });
      if (r && r.ok) { openActivity(); }
      else { btn.disabled = false; btn.textContent = prev; alert((r && r.error && r.error.message) || 'Operazione non riuscita.'); }
    };
  });
  body.querySelectorAll('[data-chat-id]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-chat-id');
      const title = btn.getAttribute('data-chat-title') || id;
      const cov = document.createElement('div');
      cov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow:auto;';
      cov.innerHTML = '<div style="background:#fff;color:#111;max-width:640px;width:100%;border-radius:14px;padding:16px 18px;box-shadow:0 20px 60px rgba(0,0,0,.35);"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"><strong style="font-size:16px;">\uD83D\uDCAC ' + escapeHtml(title) + '</strong><button id="chatClose" type="button" style="border:0;background:#eee;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:15px;">\u2715</button></div><div id="chatBody"><p style="color:#666;">Carico\u2026</p></div></div>';
      document.body.appendChild(cov);
      const closeC = () => cov.remove();
      cov.addEventListener('click', (e) => { if (e.target === cov) closeC(); });
      const cbtn = cov.querySelector('#chatClose'); if (cbtn) cbtn.onclick = closeC;
      const cbody = cov.querySelector('#chatBody');
      let cd;
      try { cd = await api('GET', '/api/activity/chat?id=' + encodeURIComponent(id)); } catch { cd = null; }
      if (!cd || !cd.ok) { cbody.innerHTML = '<p style="color:#b00;">Impossibile caricare la chat.</p>'; return; }
      const msgs = cd.messages || [];
      if (!msgs.length) { cbody.innerHTML = '<p style="color:#999;">Nessun messaggio ancora.</p>'; return; }
      const fmtT = (s) => { try { return s ? new Date(s).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; } catch { return ''; } };
      cbody.innerHTML = msgs.map((m) => {
        const me = m.role === 'user';
        return '<div style="display:flex;justify-content:' + (me ? 'flex-end' : 'flex-start') + ';margin:6px 0;"><div style="max-width:80%;background:' + (me ? '#eef0ff' : '#f3f3f5') + ';border-radius:12px;padding:8px 11px;font-size:13.5px;line-height:1.4;white-space:pre-wrap;word-break:break-word;">' + escapeHtml(m.text) + '<div style="font-size:10.5px;color:#999;margin-top:4px;">' + (me ? 'Cliente' : 'AI') + ' \u00b7 ' + escapeHtml(fmtT(m.at)) + '</div></div></div>';
      }).join('');
    };
  });
  body.querySelectorAll('[data-pause-id]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-pause-id');
      if (!confirm('Mettere in pausa questo sito scaduto? Resta salvato ma non più modificabile finché il proprietario non lo attiva.')) return;
      btn.disabled = true; const prev = btn.textContent; btn.textContent = '…';
      const r = await api('POST', `/api/projects/${encodeURIComponent(id)}/lock`);
      if (r && r.ok) { openActivity(); }
      else { btn.disabled = false; btn.textContent = prev; alert((r && r.error && r.error.message) || 'Operazione non riuscita.'); }
    };
  });
  const freeAddBtn = body.querySelector('#freeAddBtn');
  if (freeAddBtn) freeAddBtn.onclick = async () => {
    const inp = body.querySelector('#freeEmailInput');
    const email = ((inp && inp.value) || '').trim();
    if (!email) { if (inp) inp.focus(); return; }
    freeAddBtn.disabled = true; freeAddBtn.textContent = '…';
    const r = await api('POST', '/api/admin/free', { email, value: true });
    if (r && r.ok) { openActivity(); }
    else { freeAddBtn.disabled = false; freeAddBtn.textContent = 'Attiva gratis'; alert((r && r.error && r.error.message) || 'Operazione non riuscita.'); }
  };
  body.querySelectorAll('[data-free-rm]').forEach((btn) => {
    btn.onclick = async () => {
      const email = btn.getAttribute('data-free-rm');
      btn.disabled = true; btn.textContent = '…';
      const r = await api('POST', '/api/admin/free', { email, value: false });
      if (r && r.ok) { openActivity(); }
      else { btn.disabled = false; btn.textContent = 'Disattiva'; alert((r && r.error && r.error.message) || 'Operazione non riuscita.'); }
    };
  });
  const statUsersEl = body.querySelector('#statUsers');
  if (statUsersEl) statUsersEl.onclick = () => openUsers();
  const inviteGenBtn = body.querySelector('#inviteGenBtn');
  if (inviteGenBtn) inviteGenBtn.onclick = async () => {
    const durEl = body.querySelector('#inviteDur');
    const hours = Number((durEl && durEl.value) || 24);
    inviteGenBtn.disabled = true; inviteGenBtn.textContent = '…';
    const r = await api('POST', '/api/admin/invite', { hours });
    inviteGenBtn.disabled = false; inviteGenBtn.textContent = 'Genera link';
    const out = body.querySelector('#inviteOut');
    if (r && r.ok && out) {
      out.style.display = 'block';
      out.innerHTML = `<div style="display:flex;gap:6px;align-items:center;"><input readonly value="${escapeHtml(r.url)}" style="flex:1;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-size:13px;background:#fafafa;" /><button id="inviteCopyNew" type="button" style="border:0;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:13px;font-weight:600;background:#1c7a4a;color:#fff;">Copia</button></div><p style="color:#999;font-size:12px;margin:6px 0 0;">Chi apre questo link e accede con la sua email diventa account gratis.</p>`;
      const cp = out.querySelector('#inviteCopyNew');
      if (cp) cp.onclick = () => copyText(r.url, cp);
      setTimeout(() => openActivity(), 1500);
    } else { alert((r && r.error && r.error.message) || 'Generazione non riuscita.'); }
  };
  body.querySelectorAll('[data-inv-copy]').forEach((btn) => { btn.onclick = () => copyText(btn.getAttribute('data-inv-copy'), btn); });
  body.querySelectorAll('[data-inv-rm]').forEach((btn) => {
    btn.onclick = async () => {
      const token = btn.getAttribute('data-inv-rm');
      btn.disabled = true; btn.textContent = '…';
      const r = await api('POST', '/api/admin/invite/revoke', { token });
      if (r && r.ok) { openActivity(); }
      else { btn.disabled = false; btn.textContent = 'Disattiva'; alert((r && r.error && r.error.message) || 'Operazione non riuscita.'); }
    };
  });
  const staffAddBtn = body.querySelector('#staffAddBtn');
  if (staffAddBtn) staffAddBtn.onclick = async () => {
    const inp = body.querySelector('#staffEmailInput');
    const email = ((inp && inp.value) || '').trim();
    if (!email) { if (inp) inp.focus(); return; }
    staffAddBtn.disabled = true; staffAddBtn.textContent = '…';
    const r = await api('POST', '/api/admin/staff', { email, value: true });
    if (r && r.ok) { openActivity(); }
    else { staffAddBtn.disabled = false; staffAddBtn.textContent = 'Aggiungi'; alert((r && r.error && r.error.message) || 'Operazione non riuscita.'); }
  };
  body.querySelectorAll('[data-staff-rm]').forEach((btn) => {
    btn.onclick = async () => {
      const email = btn.getAttribute('data-staff-rm');
      btn.disabled = true; btn.textContent = '…';
      const r = await api('POST', '/api/admin/staff', { email, value: false });
      if (r && r.ok) { openActivity(); }
      else { btn.disabled = false; btn.textContent = 'Rimuovi'; alert((r && r.error && r.error.message) || 'Operazione non riuscita.'); }
    };
  });
  body.querySelectorAll('[data-fb-rm]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-fb-rm');
      btn.disabled = true; btn.textContent = '…';
      const r = await api('POST', '/api/admin/feedback/dismiss', { id });
      if (r && r.ok) { openActivity(); }
      else { btn.disabled = false; btn.textContent = 'Fatto'; }
    };
  });
  const rangeSel = body.querySelector('#rangeSel');
  const rangeDay = body.querySelector('#rangeDay');
  const applyRange = () => {
    const v = rangeSel ? rangeSel.value : '7d';
    const now = Date.now();
    if (v === 'day') {
      if (rangeDay) { rangeDay.style.display = ''; if (!rangeDay.value) rangeDay.value = new Date().toISOString().slice(0, 10); }
      const parts = ((rangeDay && rangeDay.value) || new Date().toISOString().slice(0, 10)).split('-').map(Number);
      const from = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0).getTime();
      loadMetrics(from, from + 86400000);
    } else {
      if (rangeDay) rangeDay.style.display = 'none';
      let from = now - 7 * 86400000;
      if (v === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); from = d.getTime(); }
      else if (v === '24h') from = now - 86400000;
      else if (v === '3d') from = now - 3 * 86400000;
      else if (v === '30d') from = now - 30 * 86400000;
      else if (v === '90d') from = now - 90 * 86400000;
      loadMetrics(from, now);
    }
  };
  if (rangeSel) rangeSel.onchange = applyRange;
  if (rangeDay) rangeDay.onchange = () => { if (rangeSel && rangeSel.value === 'day') applyRange(); };
  applyRange();
}

function copyText(text, btn) {
  const done = () => { if (btn) { const p = btn.textContent; btn.textContent = 'Copiato ✓'; setTimeout(() => { btn.textContent = p; }, 1400); } };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done).catch(done); return; }
  } catch (e) { /* fallback sotto */ }
  try { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); done(); } catch (e) { /* niente */ }
}

async function loadMetrics(from, to) {
  const host = document.getElementById('andamentoBody');
  if (!host) return;
  host.innerHTML = '<p style="color:#999;padding:6px 2px;">Carico…</p>';
  let d;
  try { d = await api('GET', '/api/metrics?from=' + Math.round(from) + '&to=' + Math.round(to)); } catch { d = null; }
  if (!host.isConnected) return;
  if (!d || !d.ok) { host.innerHTML = '<p style="color:#b00;padding:6px 2px;">Impossibile caricare le metriche.</p>'; return; }
  const fn = d.funnel || {};
  const base = Math.max(fn.visitors || 0, fn.views || 0, 1);
  const pct = (a, b) => b ? Math.round((a / b) * 100) + '%' : '—';
  const fRow = (label, val, sub) => { const w = Math.max(2, Math.round(((val || 0) / base) * 100)); return `<div style="padding:6px 2px;"><div style="display:flex;justify-content:space-between;font-size:13px;"><span>${label}${sub ? ` <span style="color:#aaa;">${sub}</span>` : ''}</span><strong>${val || 0}</strong></div><div style="height:6px;background:#eee;border-radius:4px;margin-top:4px;overflow:hidden;"><div style="height:100%;width:${w}%;background:#5b5bf0;border-radius:4px;"></div></div></div>`; };
  const funnelHtml = fRow('Visitatori unici', fn.visitors) + fRow('Pagine viste', fn.views)
    + fRow('Prompt iniziati', fn.promptStarted, '· ' + pct(fn.promptStarted, fn.visitors) + ' delle visite')
    + fRow('Siti creati', fn.created, '· ' + pct(fn.created, fn.promptStarted) + ' dei prompt')
    + fRow('Modifiche', fn.edited) + fRow('Login', fn.login)
    + fRow('Pubblicati', fn.published, '· ' + pct(fn.published, fn.created) + ' dei creati');
  const cats = d.categories || [];
  const maxCat = cats.length ? Math.max.apply(null, cats.map((c) => c.count)) : 1;
  const catHtml = cats.length ? cats.map((c) => { const w = Math.max(4, Math.round((c.count / maxCat) * 100)); return `<div style="padding:5px 2px;"><div style="display:flex;justify-content:space-between;font-size:13px;"><span>${escapeHtml(c.name)}</span><strong>${c.count}</strong></div><div style="height:6px;background:#eee;border-radius:4px;margin-top:3px;overflow:hidden;"><div style="height:100%;width:${w}%;background:#1c7a4a;border-radius:4px;"></div></div></div>`; }).join('') : '<p style="color:#999;padding:6px 2px;">Nessuna richiesta nel periodo.</p>';
  const series = d.series || [];
  let seriesHtml = '';
  if (series.length > 1) {
    const cell = (v) => `<td style="text-align:right;padding:4px 6px;border-bottom:1px solid #f3f3f3;">${v || 0}</td>`;
    seriesHtml = '<div style="overflow-x:auto;margin-top:6px;"><table style="border-collapse:collapse;width:100%;font-size:12px;"><thead><tr>'
      + ['Giorno', 'Vis.', 'Pag.', 'Prompt', 'Creati', 'Mod.', 'Login', 'Pubbl.'].map((h, i) => `<th style="text-align:${i ? 'right' : 'left'};padding:4px 6px;color:#999;font-weight:600;border-bottom:1px solid #eee;white-space:nowrap;">${h}</th>`).join('')
      + '</tr></thead><tbody>'
      + series.map((r) => { const dd = String(r.day || '').slice(8, 10) + '/' + String(r.day || '').slice(5, 7); return `<tr><td style="text-align:left;padding:4px 6px;border-bottom:1px solid #f3f3f3;white-space:nowrap;">${dd}</td>${cell(r.visitors)}${cell(r.views)}${cell(r.promptStarted)}${cell(r.created)}${cell(r.edited)}${cell(r.login)}${cell(r.published)}</tr>`; }).join('')
      + '</tbody></table></div>';
  }
  host.innerHTML = '<div style="font-size:11px;color:#999;margin-bottom:2px;">Funnel</div>' + funnelHtml
    + '<div style="font-size:11px;color:#999;margin:12px 0 2px;">Categorie più richieste</div>' + catHtml
    + (seriesHtml ? '<div style="font-size:11px;color:#999;margin:12px 0 2px;">Dettaglio per giorno</div>' + seriesHtml : '');
}

async function openUsers() {
  const old = document.getElementById('usersOverlay');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'usersOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10001;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow:auto;';
  ov.innerHTML = '<div style="background:#fff;color:#111;max-width:560px;width:100%;border-radius:14px;padding:18px 20px;box-shadow:0 20px 60px rgba(0,0,0,.3);"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"><strong style="font-size:18px;">Utenti iscritti</strong><button id="usersClose" type="button" style="border:0;background:#eee;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:15px;">✕</button></div><div id="usersBody"><p style="color:#666;">Carico…</p></div></div>';
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  const cb = ov.querySelector('#usersClose'); if (cb) cb.onclick = close;
  const body = ov.querySelector('#usersBody');
  let data;
  try { data = await api('GET', '/api/admin/users'); } catch { data = null; }
  if (!data || !data.ok) { body.innerHTML = '<p style="color:#b00;">Impossibile caricare gli utenti.</p>'; return; }
  const users = data.users || [];
  const fmtD = (s) => { try { return s ? new Date(s).toLocaleDateString('it-IT') : ''; } catch { return ''; } };
  body.innerHTML = users.length ? users.map((u) => {
    const badges = [
      u.operator ? '<span style="font-size:10.5px;font-weight:700;color:#5b5bf0;background:#eaeaff;border-radius:6px;padding:2px 7px;">OPERATORE</span>' : '',
      u.free ? '<span style="font-size:10.5px;font-weight:700;color:#1c7a4a;background:#e3f6ec;border-radius:6px;padding:2px 7px;">GRATIS</span>' : '',
      u.blocked ? '<span style="font-size:10.5px;font-weight:700;color:#9b2c2c;background:#f6e3e3;border-radius:6px;padding:2px 7px;">BLOCCATO</span>' : '',
    ].filter(Boolean).join(' ');
    const btn = u.operator ? ''
      : `<button data-block-email="${escapeHtml(u.email)}" data-block-val="${u.blocked ? '0' : '1'}" type="button" style="border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;font-weight:600;${u.blocked ? 'background:#e3f6ec;color:#1c7a4a;' : 'background:#f1d6d6;color:#9b2c2c;'}">${u.blocked ? 'Sblocca' : 'Blocca'}</button>`;
    return `<div style="border-top:1px solid #eee;padding:10px 2px;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <span style="font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(u.email)}</span>
        ${btn}
      </div>
      <div style="font-size:12px;color:#888;margin-top:3px;">iscritto ${escapeHtml(fmtD(u.createdAt))} · ${u.sites} sit${u.sites === 1 ? 'o' : 'i'} ${badges ? '· ' + badges : ''}</div>
    </div>`;
  }).join('') : '<p style="color:#999;padding:8px 2px;">Nessun utente registrato.</p>';
  body.querySelectorAll('[data-block-email]').forEach((b) => {
    b.onclick = async () => {
      const email = b.getAttribute('data-block-email');
      const value = b.getAttribute('data-block-val') === '1';
      if (value && !confirm('Bloccare ' + email + '? Non potrà più creare o modificare siti.')) return;
      b.disabled = true; const prev = b.textContent; b.textContent = '…';
      const r = await api('POST', '/api/admin/block', { email, value });
      if (r && r.ok) { openUsers(); }
      else { b.disabled = false; b.textContent = prev; alert((r && r.error && r.error.message) || 'Operazione non riuscita.'); }
    };
  });
}
function injectActivityBtn() {
  try {
    const actions = document.querySelector('.top-actions');
    if (!actions || document.getElementById('activityBtn')) return;
    const b = document.createElement('button');
    b.id = 'activityBtn';
    b.className = 'btn ghost';
    b.type = 'button';
    b.textContent = 'Dashboard';
    b.onclick = openActivity;
    const nb = document.getElementById('newBtn');
    if (nb) actions.insertBefore(b, nb); else actions.appendChild(b);
  } catch (e) { /* non bloccare il cockpit */ }
}

async function setupAuth() {
  try {
    const r = await api('GET', '/api/auth/me');
    return { authRequired: !!(r && r.authRequired), anonTrial: !!(r && r.anonTrial), user: (r && r.user) || null };
  } catch (e) { return { authRequired: false, anonTrial: false, user: null }; }
}

function injectLogout(user) {
  try {
    const actions = document.querySelector('.top-actions');
    if (!actions || document.getElementById('logoutBtn')) return;
    const b = document.createElement('button');
    b.id = 'logoutBtn';
    b.className = 'btn ghost';
    b.type = 'button';
    b.title = (user && user.email) ? user.email : '';
    b.innerHTML = '<span class="btn-text">Esci</span><svg class="btn-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
    b.onclick = async () => { try { await api('POST', '/api/auth/logout'); } catch (e) {} location.href = '/'; };
    actions.appendChild(b);
  } catch (e) {}
}

function showLoginScreen(opts) {
  const o = opts || {};
  if (document.getElementById('loginOverlay')) return;
  const ov = document.createElement('div');
  ov.id = 'loginOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(11,11,20,.97);color:#fff;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;';
  const closeBtn = o.dismissible ? '<button id="loginClose" type="button" aria-label="Chiudi" style="position:absolute;top:16px;right:18px;background:none;border:0;color:#9aa3b2;font-size:26px;line-height:1;cursor:pointer;">×</button>' : '';
  ov.innerHTML = `
    ${closeBtn}
    <div style="max-width:380px;width:100%;text-align:center;font-family:inherit;">
      <img src="/brik-logo-light.png" alt="brik" style="width:168px;max-width:70%;height:auto;display:block;margin:0 auto 22px;animation:float 4s ease-in-out infinite;filter:drop-shadow(0 14px 34px rgba(124,140,255,.38));" />
      <h2 style="font-size:19px;margin:0 0 6px;font-weight:600;">${escapeHtml(o.title || 'Accedi')}</h2>
      <p style="color:#9aa3b2;margin:0 0 18px;font-size:14px;line-height:1.4;">${escapeHtml(o.sub || 'Inserisci la tua email: ti mandiamo un link per entrare, senza password.')}</p>
      <input id="loginEmail" type="email" inputmode="email" autocomplete="email" placeholder="tu@email.it" style="width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;border:1px solid #2c2c3a;background:#15151f;color:#fff;font-size:15px;margin-bottom:10px;outline:none;" />
      <button id="loginSend" type="button" style="width:100%;padding:12px 14px;border:0;border-radius:10px;background:#5b5bf0;color:#fff;font-size:15px;font-weight:600;cursor:pointer;">Inviami il link</button>
      <p id="loginMsg" style="color:#9aa3b2;font-size:13px;margin:12px 0 0;min-height:18px;"></p>
    </div>`;
  document.body.appendChild(ov);
  if (o.dismissible) {
    const close = () => { try { ov.remove(); } catch (e) {} };
    const x = ov.querySelector('#loginClose'); if (x) x.onclick = close;
    ov.addEventListener('click', (ev) => { if (ev.target === ov) close(); });
  }
  const email = ov.querySelector('#loginEmail');
  const btn = ov.querySelector('#loginSend');
  const msg = ov.querySelector('#loginMsg');
  const send = async () => {
    const e = (email.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { msg.textContent = 'Email non valida.'; return; }
    btn.disabled = true; msg.textContent = 'Invio in corso…';
    try {
      await api('POST', '/api/auth/request', { email: e });
      msg.textContent = 'Fatto. Controlla la mail e apri il link per entrare.';
    } catch (err) { msg.textContent = 'Errore, riprova.'; btn.disabled = false; }
  };
  btn.onclick = send;
  email.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') send(); });
  setTimeout(() => { try { email.focus(); } catch (e) {} }, 50);
}

// Richiesta di login contestuale (ospite che ha raggiunto il limite): overlay chiudibile.
function promptAuth(message) {
  showLoginScreen({ title: 'Accedi per continuare', sub: message || 'Il tuo sito è salvato: accedi e riprendi da dove eri.', dismissible: true });
}

// Bottone "Accedi" per gli ospiti (così possono entrare prima di esaurire la prova).
function injectGuestLogin() {
  try {
    const actions = document.querySelector('.top-actions');
    if (!actions || document.getElementById('guestLoginBtn')) return;
    const b = document.createElement('button');
    b.id = 'guestLoginBtn';
    b.className = 'btn ghost';
    b.type = 'button';
    b.innerHTML = '<span class="btn-text">Accedi</span><svg class="btn-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';
    b.onclick = () => showLoginScreen({ title: 'Accedi a brik', sub: 'Ti mandiamo un link per entrare, senza password. I siti che crei restano salvati nel tuo account.', dismissible: true });
    actions.appendChild(b);
  } catch (e) {}
}

async function maybeRedeemInvite() {
  let tok = null;
  try { tok = localStorage.getItem('brik_invite'); } catch (e) {}
  if (!tok) return;
  if (authUser) {
    const r = await api('POST', '/api/free/redeem', { token: tok });
    try { localStorage.removeItem('brik_invite'); } catch (e) {}
    if (r && r.ok) addMsg('bot', '<p><strong>Accesso gratuito attivato</strong> sul tuo account ✓ I tuoi siti non hanno limiti di prova.</p>');
    else addMsg('bot', '<p>Il link di accesso gratuito non è più valido o è scaduto.</p>');
  } else {
    showLoginScreen({ title: "Attiva l'accesso gratuito", sub: "Hai un invito gratis a brik. Inserisci la tua email per entrare: l'accesso gratis viene attivato sul tuo account.", dismissible: true });
  }
}

(async () => {
  // Cattura subito un eventuale link di invito gratis, così sopravvive al giro del magic-link.
  try {
    const sp0 = new URLSearchParams(location.search);
    const ftok = sp0.get('free');
    if (ftok) {
      try { localStorage.setItem('brik_invite', ftok); } catch (e) {}
      sp0.delete('free');
      const qs = sp0.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
    }
  } catch (e) {}
  const auth = await setupAuth();
  authUser = auth.user || null;
  if (auth.authRequired && !auth.user && !auth.anonTrial) { showLoginScreen(); return; }
  if (auth.authRequired && !auth.user && auth.anonTrial) injectGuestLogin();
  if (!auth.authRequired || (auth.user && auth.user.isOperator)) injectActivityBtn();
  if (auth.user) injectLogout(auth.user);
  setMobileView('chat');
  setAppHeight();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', setAppHeight);
    window.visualViewport.addEventListener('scroll', setAppHeight);
  }
  window.addEventListener('resize', setAppHeight);
  window.addEventListener('focusin', () => { setTimeout(setAppHeight, 60); setTimeout(setAppHeight, 350); });
  await refreshProjects();
  // Dopo il magic link apre direttamente il progetto reclamato.
  // Il parametro site associato a paid resta gestito dal flusso Stripe.
  let bootSite = '';
  try {
    const bootParams = new URLSearchParams(location.search);
    if (!bootParams.has('paid')) bootSite = bootParams.get('site') || '';
  } catch (e) {}

  if (bootSite) {
    try {
      const cleanParams = new URLSearchParams(location.search);
      cleanParams.delete('site');
      cleanParams.delete('from');
      const cleanQuery = cleanParams.toString();
      history.replaceState(null, '', location.pathname + (cleanQuery ? '?' + cleanQuery : ''));
    } catch (e) {}
    await openProject(bootSite);
  } else {
    const last = readLastProject();
    if (last && hasProjectOption(last)) openProject(last);
    else if (auth.user && !auth.user.isOperator && projectList.length >= 1) openProject(projectList[0].id);
    else if (auth.user) hideLanding();
    else showLanding();
  }
  try { await maybeRedeemInvite(); } catch (e) {}
  try {
    const sp = new URLSearchParams(location.search);
    if (sp.get('paid') === '1') {
      addMsg('bot', '<p>Pagamento ricevuto. Sto attivando il sito… (può richiedere qualche secondo)</p>');
      const sid = sp.get('site');
      history.replaceState(null, '', location.pathname);
      if (sid) setTimeout(() => { if (currentId === sid) openProject(sid); }, 3000);
    } else if (sp.get('paid') === '0') {
      history.replaceState(null, '', location.pathname);
    }
  } catch (e) {}
  try {
    const _pp = (new URLSearchParams(location.search)).get('prompt');
    if (_pp && landingInput) {
      landingInput.value = _pp;
      showLanding();
      try { if (window.fbq) fbq('trackCustom', 'AvvioIntake', { source: 'campagna', prompt: String(_pp).slice(0, 60) }); } catch (e) {}
      history.replaceState(null, '', location.pathname);
      setTimeout(() => { startFromLanding(_pp); }, 80);
    }
  } catch (e) {}
  try {
    const _loginSub = 'Inserisci la tua email: ti mandiamo un link per entrare, senza password. I siti che crei restano salvati nel tuo account.';
    const _loginLinks = document.querySelectorAll('a[href="/?login=1"]');
    if (auth && auth.user) {
      _loginLinks.forEach((a) => { a.style.display = 'none'; });
    } else {
      _loginLinks.forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault();
        showLoginScreen({ title: 'Accedi a brik', sub: _loginSub, dismissible: true });
      }));
      const _lg = (new URLSearchParams(location.search)).get('login');
      if (_lg) {
        showLoginScreen({ title: 'Accedi a brik', sub: _lg === 'expired' ? 'Il link è scaduto. Inserisci la tua email: te ne mandiamo uno nuovo.' : _loginSub, dismissible: true });
        history.replaceState(null, '', location.pathname);
      }
    }
  } catch (e) {}
})();
