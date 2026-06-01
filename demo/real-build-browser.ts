/**
 * VERTICAL SLICE con QA su BROWSER REALE.
 *
 *   frase -> criterio tipizzato (intake)
 *         -> codice generato (LLM)
 *         -> sito servito su un server locale
 *         -> verifica in Chromium reale (Playwright): responsive e JS veri.
 *
 * Prerequisiti (una tantum):
 *   npm install playwright
 *   npx playwright install chromium
 *
 * Lancio:  npx tsx --env-file=.env demo/real-build-browser.ts
 */
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeAnthropicLLM, makeAnthropicCodeGenerator } from '../src/adapters/index.js';
import { buildCriteria, makeAnthropicClassifier } from '../src/intake/index.js';
import { makePlaywrightQaRunner } from '../src/qa/playwrightRunner.js';
import type { ProjectSpec } from '../src/core/index.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Manca ANTHROPIC_API_KEY. Lancia: npx tsx --env-file=.env demo/real-build-browser.ts');
  process.exit(1);
}

const llm = makeAnthropicLLM({ apiKey: key });
const classifier = makeAnthropicClassifier({ apiKey: key });
const codegen = makeAnthropicCodeGenerator(llm);

const knownRoutes = ['/'];
const statements = [
  'La home deve mostrare il titolo "Trattoria da Mario"',
  'Deve esserci la scritta "Cucina sarda dal 1985"',
  'Voglio un form contatti con nome, email e messaggio che mostra "Grazie, ti risponderemo presto" dopo invio',
  'Deve funzionare bene su mobile',
];
const context = { category: 'business-landing', knownRoutes };

console.log('1) Intake: frasi -> criteri tipizzati...');
const crit = await buildCriteria({ statements, context }, classifier);
if (!crit.ok) {
  console.error('Intake fallito: ' + crit.error.message);
  process.exit(1);
}
for (const c of crit.value) {
  console.log('   ' + c.id + ': ' + (c.check ? c.check.kind : 'SEGNALATO (non testabile)'));
}

const spec: ProjectSpec = {
  id: 'demo-trattoria',
  ownerId: 'demo-user',
  category: 'business-landing',
  title: 'Trattoria da Mario',
  description: 'Sito vetrina per una trattoria sarda, con form contatti.',
  criteria: crit.value,
};

console.log('\n2) Generazione codice con LLM reale...');
const gen = await codegen.generate(spec);
if (!gen.ok) {
  console.error('Codegen fallito [' + gen.error.code + ']: ' + gen.error.message);
  process.exit(1);
}
const indexHtml = gen.value.files.find((f) => f.path === 'index.html')?.contents;
if (!indexHtml) {
  console.error('Nessun index.html generato.');
  process.exit(1);
}
console.log('   Generato index.html (' + indexHtml.length + ' caratteri)');
writeFileSync(new URL('./generated.html', import.meta.url), indexHtml);

// Server statico minimale: serve il sito generato alla route "/".
const server = createServer((req, res) => {
  const u = (req.url ?? '/').split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as AddressInfo).port;
const baseUrl = 'http://localhost:' + port;

console.log('\n3) QA su BROWSER REALE (Chromium) — ' + baseUrl + ' ...');
try {
  const qa = makePlaywrightQaRunner(baseUrl, knownRoutes);
  const report = await qa.run(gen.value, spec);
  if (!report.ok) {
    console.error('QA fallita: ' + report.error.message);
    process.exit(1);
  }
  const r = report.value;
  const mark = (p: boolean) => (p ? 'PASS' : 'FAIL');
  console.log('   --- Livello 1 (deterministico) ---');
  for (const x of r.level1) {
    console.log('   ' + mark(x.passed) + '  ' + x.criterionId + (x.detail ? '  — ' + x.detail : ''));
  }
  console.log('   --- Livello 2 (browser reale) ---');
  for (const x of r.level2) {
    console.log('   ' + mark(x.passed) + '  ' + x.kind + ' [' + x.criterionId + ']' + (x.detail ? '  — ' + x.detail : ''));
  }
  if (r.flagged.length > 0) {
    console.log('   --- Segnalati (verifica manuale) ---');
    for (const f of r.flagged) console.log('   •  ' + f.criterionId + ': ' + f.statement);
  }
  console.log('');
  console.log(
    r.buildSucceeded
      ? 'BUILD RIUSCITA: verificata in un browser reale.'
      : 'BUILD NON riuscita: almeno un check fallisce (vedi sopra). Qui servira l\'auto-fix.',
  );
} finally {
  server.close();
}

console.log('\nSito generato in demo/generated.html.');
