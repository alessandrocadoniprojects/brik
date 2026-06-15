const styles = [
  { id: 'napoletana-heritage', name: 'Napoletana Heritage', type: 'Napoletana tradizionale', desc: 'Forno, tradizione e prenotazioni.', theme: 'warm-bistro', mood: 'Calda e tradizionale' },
  { id: 'al-taglio-urban', name: 'Al Taglio Urban', type: 'Al taglio / asporto', desc: 'Tranci, pranzo e WhatsApp.', theme: 'warm-bistro', mood: 'Giovane e vivace' },
  { id: 'gourmet-degustazione', name: 'Gourmet Degustazione', type: 'Gourmet / ingredienti ricercati', desc: 'Impasti, ingredienti e atmosfera premium.', theme: 'editorial-luxury', mood: 'Premium e curata' },
  { id: 'familiare-quartiere', name: 'Familiare / Quartiere', type: 'Familiare di quartiere', desc: 'Locale, semplice e accogliente.', theme: 'warm-bistro', mood: 'Familiare e accogliente' },
  { id: 'pizza-birre-serale', name: 'Pizza + Birre / Serale', type: 'Pizzeria + birre / vini', desc: 'Serale, tavoli e abbinamenti.', theme: 'warm-bistro', mood: 'Serale e intima' },
  { id: 'contemporanea-minimal', name: 'Contemporanea Minimal', type: 'Contemporanea', desc: 'Pulita, moderna e curata.', theme: 'warm-bistro', mood: 'Minimal contemporanea' },
  { id: 'romana-pinsa-focaccia', name: 'Romana / Pinsa / Focaccia', type: 'Contemporanea', desc: 'Croccante, leggera e prodotto-first.', theme: 'warm-bistro', mood: 'Calda e tradizionale' },
  { id: 'delivery-takeaway', name: 'Delivery / Take Away', type: 'Al taglio / asporto', desc: 'Ordini rapidi e conversione.', theme: 'warm-bistro', mood: 'Giovane e vivace' },
];

const grid = document.getElementById('styleGrid');
const shell = document.getElementById('formShell');
const form = document.getElementById('intakeForm');
const statusEl = document.getElementById('status');
const submit = form.querySelector('.submit');
let selected = null;

styles.forEach((s, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'style-card';
  b.dataset.index = String(i);
  b.innerHTML = `<span class="preview" aria-hidden="true"></span><strong>${s.name}</strong><small>${s.desc}</small>`;
  b.onclick = () => {
    selected = s;
    document.querySelectorAll('.style-card').forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected');
    shell.hidden = false;
    document.getElementById('formTitle').textContent = `Configura ${s.name}`;
    const mood = [...document.querySelectorAll('[data-name="mood"] button')].find((x) => x.textContent === s.mood);
    if (mood) {
      mood.parentElement.querySelectorAll('button').forEach((x) => x.classList.remove('selected'));
      mood.classList.add('selected');
    }
    shell.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  grid.appendChild(b);
});

document.querySelectorAll('.choices').forEach((g) => {
  const multi = g.dataset.multi === 'true';
  g.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      if (!multi) g.querySelectorAll('button').forEach((x) => x.classList.remove('selected'));
      b.classList.toggle('selected');
    };
  });
});

const vals = (n) => [...document.querySelectorAll(`[data-name="${n}"] button.selected`)].map((x) => x.textContent.trim());

async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json().catch(() => ({ ok: false, error: { message: 'Risposta non valida' } }));
}

form.onsubmit = async (e) => {
  e.preventDefault();
  if (!selected) {
    statusEl.textContent = 'Seleziona prima uno stile.';
    return;
  }

  const fd = new FormData(form);
  const name = String(fd.get('name') || '').trim();
  const locationText = String(fd.get('location') || '').trim();
  const notes = String(fd.get('notes') || '').trim();
  const cta = vals('cta')[0] || '';

  if (!name || !cta) {
    statusEl.textContent = "Inserisci il nome e scegli l'azione principale.";
    return;
  }

  const pizzeriaAnswers = {
    stylePreset: selected.id,
    name,
    type: selected.type,
    cta,
    mood: vals('mood')[0] || selected.mood,
    strength: vals('strength'),
    products: vals('products'),
  };

  const description = [
    `${name} è una pizzeria ${selected.type.toLowerCase()}.`,
    locationText ? `Si trova a ${locationText}.` : '',
    notes,
  ].filter(Boolean).join(' ');

  submit.disabled = true;
  statusEl.textContent = 'Avvio la costruzione…';

  try {
    const start = await api('POST', '/api/projects', {
      description,
      answers: [],
      sources: [],
      images: [],
      theme: selected.theme,
      pizzeriaAnswers,
    });

    if (!start.ok || !start.id) {
      throw new Error(start.error?.message || 'Creazione non riuscita');
    }

    try {
      sessionStorage.setItem('brik:pizzeriaProject', start.id);
    } catch {}

    window.location.href = `/?site=${encodeURIComponent(start.id)}&from=pizzerie`;
  } catch (err) {
    statusEl.textContent = err?.message || 'Errore durante la creazione.';
    submit.disabled = false;
  }
};

/* wizard pizzerie */
;(() => {
  const f = document.getElementById('intakeForm');
  if (!f) return;

  const steps = [...f.children].filter((x) => x.matches('label,fieldset'));
  const hiddenSubmit = f.querySelector('.submit');
  const st = document.getElementById('status');
  let index = 0;

  const progress = document.createElement('div');
  const count = document.createElement('p');
  const nav = document.createElement('div');

  progress.className = 'wizard-progress';
  progress.innerHTML = '<span></span>';
  count.className = 'wizard-count';
  nav.className = 'wizard-nav';
  nav.innerHTML = '<button type="button" class="wizard-back">Indietro</button><button type="button" class="wizard-next">Avanti</button>';

  f.insertBefore(progress, steps[0]);
  f.insertBefore(count, steps[0]);
  f.insertBefore(nav, hiddenSubmit);

  steps.forEach((x) => x.classList.add('wizard-step'));

  const back = nav.children[0];
  const next = nav.children[1];

  function show(nextIndex) {
    index = nextIndex;
    steps.forEach((x, i) => x.classList.toggle('active', i === index));
    progress.firstElementChild.style.width = `${((index + 1) / steps.length) * 100}%`;
    count.textContent = `Domanda ${index + 1} di ${steps.length}`;
    back.style.visibility = index ? 'visible' : 'hidden';
    next.textContent = index === steps.length - 1 ? 'Crea il sito' : 'Avanti';
    st.textContent = '';
  }

  back.onclick = () => show(index - 1);
  next.onclick = () => {
    if (index === 0 && f.elements.name.value.trim() === '') {
      st.textContent = 'Inserisci il nome della pizzeria.';
      return;
    }
    if (index === 2 && document.querySelector('[data-name="cta"] .selected') === null) {
      st.textContent = 'Scegli l’azione principale.';
      return;
    }
    index < steps.length - 1 ? show(index + 1) : f.requestSubmit();
  };

  show(0);
})();
