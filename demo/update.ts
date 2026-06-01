/**
 * DEMO aggiornamento requisiti (Fase 2).
 *
 * Parte dalla pagina attuale (demo/edit-output/<id>.html se esiste, altrimenti
 * demo/preview-output/<id>.html), modifica la lista delle frasi-requisito,
 * ri-deriva i criteri e adegua la pagina ai nuovi criteri.
 *
 * Uso:
 *   npx tsx --env-file=.env demo/update.ts <scenario> replace <n> "<nuova frase>"
 *   npx tsx --env-file=.env demo/update.ts <scenario> add "<nuova frase>"
 *   npx tsx --env-file=.env demo/update.ts <scenario> remove <n>
 *
 * Esempio (cambia il testo di conferma, prima rifiutato dall'editor):
 *   npx tsx --env-file=.env demo/update.ts portfolio-photographer replace 3 \
 *     'Form contatti con nome, email e messaggio che mostra "Richiesta inviata, ti ricontatto presto" dopo invio'
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { makeAnthropicLLM } from '../src/adapters/index.js';
import { makeAnthropicClassifier } from '../src/intake/index.js';
import { makePlaywrightQaRunner } from '../src/qa/playwrightRunner.js';
import { updateRequirements } from '../src/orchestrator/requirement.js';
import { SCENARIOS } from '../src/eval/scenarios.js';
import type { ProjectSpec } from '../src/core/index.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Manca ANTHROPIC_API_KEY.');
  process.exit(1);
}

const id = process.argv[2];
const action = process.argv[3];
const s = id ? SCENARIOS.find((x) => x.id === id) : undefined;
if (!s || !action) {
  console.error('Uso: npx tsx --env-file=.env demo/update.ts <scenario> replace|add|remove <args>');
  console.error('Scenari: ' + SCENARIOS.map((x) => x.id).join(', '));
  process.exit(1);
}

// Costruisce la nuova lista di frasi a partire dall'azione.
const old = [...s.statements];
let next: string[];
if (action === 'replace') {
  const n = Number(process.argv[4]);
  const text = process.argv.slice(5).join(' ');
  if (!Number.isInteger(n) || n < 1 || n > old.length || !text) {
    console.error('replace <n> "<frase>": n tra 1 e ' + old.length);
    process.exit(1);
  }
  next = old.map((st, i) => (i === n - 1 ? text : st));
} else if (action === 'add') {
  const text = process.argv.slice(4).join(' ');
  if (!text) {
    console.error('add "<frase>"');
    process.exit(1);
  }
  next = [...old, text];
} else if (action === 'remove') {
  const n = Number(process.argv[4]);
  if (!Number.isInteger(n) || n < 1 || n > old.length) {
    console.error('remove <n>: n tra 1 e ' + old.length);
    process.exit(1);
  }
  next = old.filter((_, i) => i !== n - 1);
} else {
  console.error('Azione non valida: ' + action + ' (replace|add|remove)');
  process.exit(1);
}

// Pagina attuale: preferisci l'ultima modificata.
const editPath = fileURLToPath(new URL('./edit-output/' + id + '.html', import.meta.url));
const previewPath = fileURLToPath(new URL('./preview-output/' + id + '.html', import.meta.url));
const srcPath = existsSync(editPath) ? editPath : existsSync(previewPath) ? previewPath : '';
if (!srcPath) {
  console.error('Manca la pagina attuale. Lancia prima:\n  npx tsx --env-file=.env demo/preview.ts ' + id);
  process.exit(1);
}
const currentHtml = readFileSync(srcPath, 'utf8');

console.log('Requisiti ATTUALI:');
old.forEach((st, i) => console.log('  ' + (i + 1) + '. ' + st));
console.log('\nRequisiti NUOVI:');
next.forEach((st, i) => console.log('  ' + (i + 1) + '. ' + st));

const llm = makeAnthropicLLM({ apiKey: key });
const classifier = makeAnthropicClassifier({ apiKey: key });

const base: ProjectSpec = {
  id: s.id,
  ownerId: 'update',
  category: s.category,
  title: s.title,
  description: s.description,
  criteria: [],
};

let served = currentHtml;
const server = createServer((req, res) => {
  const u = (req.url ?? '/').split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(served);
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});
await new Promise<void>((r) => server.listen(0, r));
const baseUrl = 'http://localhost:' + (server.address() as AddressInfo).port;
const browser = await chromium.launch();

try {
  const runQa = (html: string, spec: ProjectSpec) => {
    served = html;
    return makePlaywrightQaRunner(baseUrl, s.knownRoutes, { browser }).run(
      { specId: spec.id, templateId: 'update', files: [] },
      spec,
    );
  };

  const res = await updateRequirements({
    base,
    newStatements: next,
    currentHtml,
    classifier,
    llm,
    runQa,
    knownRoutes: s.knownRoutes,
    maxRepairs: 3,
  });
  if (!res.ok) {
    console.error('\naggiornamento: ' + res.error.message);
    process.exit(1);
  }

  const { summary: sm, outcome } = res.value;
  console.log('\n=== PAGINA ADEGUATA AI NUOVI REQUISITI ===');
  console.log('Contenuti visibili:');
  for (const t of sm.contents) console.log('  - ' + t);
  if (sm.form) console.log('Form: campi [' + sm.form.fields.join(', ') + '] -> conferma: "' + sm.form.confirmation + '"');
  console.log('Mobile verificato: ' + (sm.mobileChecked ? 'si' : 'no'));
  if (sm.manualConfirm.length) {
    console.log('Da confermare a mano:');
    for (const m of sm.manualConfirm) console.log('  - ' + m);
  }
  console.log('\nQA sui NUOVI criteri: ' + (outcome.report.buildSucceeded ? 'verde' : 'ROSSA') + ' (correzioni: ' + outcome.iterations + ')');

  if (outcome.report.buildSucceeded) {
    const outDir = new URL('./update-output/', import.meta.url);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(new URL(id + '.html', outDir), outcome.html);
    console.log('Apri:  demo/update-output/' + id + '.html');
  } else {
    console.log('Non sono riuscito ad adeguare la pagina ai nuovi requisiti entro i tentativi. Pagina non aggiornata.');
  }
} finally {
  await browser.close();
  server.close();
}
