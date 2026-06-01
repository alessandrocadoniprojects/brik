/**
 * EVAL MATRIX dal vivo.
 *
 * Esegue gli scenari (o uno solo passato come argomento) attraverso il motore
 * reale: intake (Sonnet) -> generazione (Sonnet) -> QA in Chromium -> auto-fix.
 * Misura: first-pass %, successo dopo auto-fix, correzioni medie, dove rompe.
 * Salva l'HTML finale di ogni scenario in demo/eval-output/ per ispezione.
 *
 * Lancio (tutti):      npx tsx --env-file=.env demo/eval.ts
 * Lancio (uno solo):   npx tsx --env-file=.env demo/eval.ts biz-restaurant
 *
 * NB: è lento e consuma crediti (molte chiamate LLM + browser). Conviene
 * provare prima UN singolo scenario, poi lanciare l'intera matrice.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { makeAnthropicLLM, makeAnthropicCodeGenerator } from '../src/adapters/index.js';
import { makeAnthropicClassifier } from '../src/intake/index.js';
import { makePlaywrightQaRunner } from '../src/qa/playwrightRunner.js';
import { runMatrix, type EvalDeps } from '../src/eval/matrix.js';
import { SCENARIOS } from '../src/eval/scenarios.js';
import type { ProjectSpec } from '../src/core/index.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Manca ANTHROPIC_API_KEY.');
  process.exit(1);
}

const filter = process.argv[2];
const selected = filter ? SCENARIOS.filter((s) => s.id === filter) : SCENARIOS;
if (selected.length === 0) {
  console.error('Nessuno scenario "' + filter + '". Disponibili: ' + SCENARIOS.map((s) => s.id).join(', '));
  process.exit(1);
}

const llm = makeAnthropicLLM({ apiKey: key });
const classifier = makeAnthropicClassifier({ apiKey: key });
const codegen = makeAnthropicCodeGenerator(llm); // produzione: Sonnet

const outDir = new URL('./eval-output/', import.meta.url);
mkdirSync(outDir, { recursive: true });

// Un server e un browser per tutta la matrice (currentHtml cambia a ogni QA).
let currentHtml = '';
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

const browser = await chromium.launch();

console.log('Eval su ' + selected.length + ' scenari (' + baseUrl + ')...\n');

try {
  const runQa = (html: string, spec: ProjectSpec) => {
    currentHtml = html;
    return makePlaywrightQaRunner(baseUrl, ['/'], { browser }).run(
      { specId: spec.id, templateId: 'eval', files: [] },
      spec,
    );
  };
  const deps: EvalDeps = { classifier, codegen, llm, runQa, maxRepairs: 3 };

  const { aggregate: a } = await runMatrix(selected, deps, (r) => {
    const tag = r.error
      ? 'ERRORE'
      : r.finalSuccess
        ? r.firstPass
          ? 'PASS(1°) '
          : 'PASS(+' + r.iterations + ')'
        : 'ROSSO   ';
    const extra = r.error
      ? ' — ' + r.error
      : r.initialFailKinds.length
        ? ' — rotti al 1°: ' + r.initialFailKinds.join(', ')
        : '';
    console.log(
      '[' + tag + '] ' + r.id.padEnd(24) + ' criteri ' + r.criteriaTotal + ' (segnalati ' + r.flagged + ')' + extra,
    );
    if (r.finalHtml) writeFileSync(new URL(r.id + '.html', outDir), r.finalHtml);
  });

  console.log('\n=== AGGREGATO ===');
  console.log('Scenari: ' + a.total);
  console.log('First-pass (0 correzioni): ' + Math.round(a.firstPassRate * 100) + '%');
  console.log('Successo dopo auto-fix:    ' + Math.round(a.finalSuccessRate * 100) + '%');
  console.log('Correzioni medie:          ' + a.avgRepairs.toFixed(2));
  const ff = Object.entries(a.initialFailFreq).sort((x, y) => y[1] - x[1]);
  console.log('Dove rompe al 1° colpo:    ' + (ff.map(([k, v]) => k + '×' + v).join(', ') || 'niente'));
  if (a.stillRed.length) console.log('Ancora ROSSI dopo i tentativi: ' + a.stillRed.join(', '));
  if (a.errored.length) console.log('ERRORI (intake/codegen):       ' + a.errored.join(', '));
  console.log('\nHTML finali in demo/eval-output/');
} finally {
  await browser.close();
  server.close();
}
