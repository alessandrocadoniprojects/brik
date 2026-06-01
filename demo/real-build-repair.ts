/**
 * AUTO-FIX dal vivo.
 *
 *   intake -> codice INIZIALE con modello debole (Haiku, più incline a sbagliare)
 *          -> QA in Chromium reale
 *          -> se fallisce: l'LLM (Sonnet) corregge, si ri-verifica, fino a 3 giri
 *
 * Mostra il differenziatore del prodotto: i test guidano la correzione, lo stop
 * è oggettivo (gate verde). Prereq: playwright + chromium (vedi demo precedente).
 *
 * Lancio:  npx tsx --env-file=.env demo/real-build-repair.ts
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
// Generatore INIZIALE volutamente debole, per innescare un fallimento da correggere.
const weakCodegen = makeAnthropicCodeGenerator(llm, { tier: 'fast' });

const knownRoutes = ['/'];
const statements = [
  'La home deve mostrare il titolo "Trattoria da Mario"',
  'Deve esserci la scritta "Cucina sarda dal 1985"',
  'Voglio un form contatti con nome, email e messaggio che mostra "Grazie, ti risponderemo presto" dopo invio',
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
  id: 'demo-trattoria',
  ownerId: 'demo-user',
  category: 'business-landing',
  title: 'Trattoria da Mario',
  description: 'Sito vetrina per una trattoria sarda, con form contatti.',
  criteria: crit.value,
};

console.log('\n2) Generazione INIZIALE (modello debole)...');
const gen = await weakCodegen.generate(spec);
if (!gen.ok) {
  console.error('Codegen fallito [' + gen.error.code + ']: ' + gen.error.message);
  process.exit(1);
}
const initialHtml = gen.value.files.find((f) => f.path === 'index.html')?.contents ?? '';
console.log('   index.html iniziale: ' + initialHtml.length + ' caratteri');

// Server che serve l'HTML CORRENTE (aggiornato a ogni giro di riparazione).
let currentHtml = initialHtml;
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

console.log('\n3) Auto-fix con QA in Chromium reale (max 3 giri)...');
try {
  const runQa = async (html: string) => {
    currentHtml = html; // il server ora serve questa versione
    const qa = makePlaywrightQaRunner(baseUrl, knownRoutes);
    return qa.run(gen.value, spec);
  };

  const outcome = await repairLoop({
    spec,
    llm,
    initialHtml,
    runQa,
    maxRepairs: 3,
    onStep: (i) =>
      console.log(
        '   giro ' + i.iteration + ': ' + (i.buildSucceeded ? 'RIUSCITA' : 'falliti ' + i.failing),
      ),
  });
  if (!outcome.ok) {
    console.error('Auto-fix fallito [' + outcome.error.code + ']: ' + outcome.error.message);
    process.exit(1);
  }

  const r = outcome.value.report;
  const mark = (p: boolean) => (p ? 'PASS' : 'FAIL');
  console.log('\n   --- Esito finale (browser reale) ---');
  for (const x of [...r.level1, ...r.level2]) {
    console.log('   ' + mark(x.passed) + '  ' + x.kind + ' [' + x.criterionId + ']' + (x.detail ? '  — ' + x.detail : ''));
  }
  console.log('');
  console.log(
    'Correzioni applicate: ' + outcome.value.iterations +
      ' — ' + (r.buildSucceeded ? 'BUILD RIUSCITA' : 'BUILD NON riuscita dopo i tentativi'),
  );
  currentHtml = outcome.value.html;
  writeFileSync(new URL('./generated.html', import.meta.url), outcome.value.html);
} finally {
  server.close();
}

console.log('\nSito finale in demo/generated.html.');
