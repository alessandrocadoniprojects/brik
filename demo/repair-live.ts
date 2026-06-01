/**
 * Validazione dell'AUTO-FIX sul modello vero, con guasto INIETTATO.
 *
 * Generiamo una pagina corretta, poi togliamo di proposito una frase
 * obbligatoria (così un check content-present fallisce davvero). L'auto-fix
 * riceve il fallimento reale, fa correggere a Sonnet e ri-verifica in Chromium.
 * Prova che il modello sa riparare a partire dai nostri messaggi di errore.
 *
 * Lancio:  npx tsx --env-file=.env demo/repair-live.ts
 */
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeAnthropicLLM, makeAnthropicCodeGenerator } from '../src/adapters/index.js';
import { buildCriteria, makeAnthropicClassifier } from '../src/intake/index.js';
import { makePlaywrightQaRunner } from '../src/qa/playwrightRunner.js';
import { repairLoop } from '../src/orchestrator/repair.js';
import type { ProjectSpec } from '../src/core/index.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Manca ANTHROPIC_API_KEY.');
  process.exit(1);
}

const llm = makeAnthropicLLM({ apiKey: key });
const classifier = makeAnthropicClassifier({ apiKey: key });
const codegen = makeAnthropicCodeGenerator(llm); // Sonnet: genera bene

const knownRoutes = ['/'];
const PHRASE = 'Cucina sarda dal 1985';
const statements = [
  'La home deve mostrare il titolo "Trattoria da Mario"',
  `Deve esserci la scritta "${PHRASE}"`,
  'Deve funzionare bene su mobile',
];
const context = { category: 'business-landing', knownRoutes };

console.log('1) Intake...');
const crit = await buildCriteria({ statements, context }, classifier);
if (!crit.ok) {
  console.error('Intake fallito: ' + crit.error.message);
  process.exit(1);
}
for (const c of crit.value) console.log('   ' + c.id + ': ' + (c.check ? c.check.kind : 'SEGNALATO'));

const spec: ProjectSpec = {
  id: 'demo-repair',
  ownerId: 'demo-user',
  category: 'business-landing',
  title: 'Trattoria da Mario',
  description: 'Sito vetrina per una trattoria sarda.',
  criteria: crit.value,
};

console.log('\n2) Generazione corretta (Sonnet)...');
const gen = await codegen.generate(spec);
if (!gen.ok) {
  console.error('Codegen fallito: ' + gen.error.message);
  process.exit(1);
}
const goodHtml = gen.value.files.find((f) => f.path === 'index.html')?.contents ?? '';

// GUASTO INIETTATO: rimuovo la frase obbligatoria -> il check c2 deve fallire.
const brokenHtml = goodHtml.split(PHRASE).join('Buona cucina');
const wasInjected = brokenHtml !== goodHtml;
console.log('   Guasto iniettato (frase rimossa): ' + (wasInjected ? 'sì' : 'NO — frase non trovata, demo poco utile'));

let currentHtml = brokenHtml;
const server = createServer((req, res) => {
  const u = (req.url ?? '/').split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(currentHtml);
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as AddressInfo).port;
const baseUrl = 'http://localhost:' + port;

console.log('\n3) Auto-fix con QA in Chromium (atteso: giro 0 fallisce su c2, poi riparato)...');
try {
  const runQa = async (html: string) => {
    currentHtml = html;
    return makePlaywrightQaRunner(baseUrl, knownRoutes).run(gen.value, spec);
  };
  const outcome = await repairLoop({
    spec,
    llm,
    initialHtml: brokenHtml,
    runQa,
    maxRepairs: 3,
    onStep: (i) =>
      console.log('   giro ' + i.iteration + ': ' + (i.buildSucceeded ? 'RIUSCITA' : 'falliti ' + i.failing)),
  });
  if (!outcome.ok) {
    console.error('Auto-fix fallito: ' + outcome.error.message);
    process.exit(1);
  }
  const r = outcome.value.report;
  const mark = (p: boolean) => (p ? 'PASS' : 'FAIL');
  console.log('\n   --- Esito finale ---');
  for (const x of [...r.level1, ...r.level2]) {
    console.log('   ' + mark(x.passed) + '  ' + x.kind + ' [' + x.criterionId + ']' + (x.detail ? '  — ' + x.detail : ''));
  }
  console.log('');
  console.log(
    'Correzioni applicate: ' + outcome.value.iterations +
      ' — ' + (r.buildSucceeded ? 'BUILD RIUSCITA (riparata dal modello)' : 'BUILD NON riuscita dopo i tentativi'),
  );
  writeFileSync(new URL('./generated.html', import.meta.url), outcome.value.html);
} finally {
  server.close();
}

console.log('\nSito finale in demo/generated.html.');
