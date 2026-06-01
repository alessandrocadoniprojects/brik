/**
 * DEMO anteprima-per-approvazione (Fase 2).
 *
 * intake -> genera -> QA+auto-fix -> ANTEPRIMA (pagina reale + riassunto).
 * Scrive la pagina verde in demo/preview-output/<id>.html da aprire nel browser,
 * e stampa il riassunto in parole semplici che l'utente approverebbe.
 *
 * Lancio: npx tsx --env-file=.env demo/preview.ts            (default biz-restaurant)
 *         npx tsx --env-file=.env demo/preview.ts portfolio-photographer
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { makeAnthropicLLM, makeAnthropicCodeGenerator } from '../src/adapters/index.js';
import { makeAnthropicClassifier, buildCriteria } from '../src/intake/index.js';
import { makePlaywrightQaRunner } from '../src/qa/playwrightRunner.js';
import { buildPreview } from '../src/orchestrator/preview.js';
import { SCENARIOS } from '../src/eval/scenarios.js';
import type { ProjectSpec } from '../src/core/index.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Manca ANTHROPIC_API_KEY.');
  process.exit(1);
}

const id = process.argv[2] ?? 'biz-restaurant';
const s = SCENARIOS.find((x) => x.id === id);
if (!s) {
  console.error('Scenario non trovato: ' + id + '. Disponibili: ' + SCENARIOS.map((x) => x.id).join(', '));
  process.exit(1);
}

const llm = makeAnthropicLLM({ apiKey: key });
const classifier = makeAnthropicClassifier({ apiKey: key });
const codegen = makeAnthropicCodeGenerator(llm);

const crit = await buildCriteria(
  { statements: s.statements, context: { category: s.category, knownRoutes: s.knownRoutes } },
  classifier,
);
if (!crit.ok) {
  console.error('intake: ' + crit.error.message);
  process.exit(1);
}
const spec: ProjectSpec = {
  id: s.id,
  ownerId: 'preview',
  category: s.category,
  title: s.title,
  description: s.description,
  criteria: crit.value,
};

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
const baseUrl = 'http://localhost:' + (server.address() as AddressInfo).port;
const browser = await chromium.launch();

console.log('Anteprima per "' + s.id + '"...');

try {
  const runQa = (html: string) => {
    currentHtml = html;
    return makePlaywrightQaRunner(baseUrl, s.knownRoutes, { browser }).run(
      { specId: spec.id, templateId: 'preview', files: [] },
      spec,
    );
  };

  const pkg = await buildPreview({ spec, codegen, llm, runQa, maxRepairs: 3 });
  if (!pkg.ok) {
    console.error('preview: ' + pkg.error.message);
    process.exit(1);
  }

  const outDir = new URL('./preview-output/', import.meta.url);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(new URL(s.id + '.html', outDir), pkg.value.html);

  const sm = pkg.value.summary;
  console.log('\n=== ANTEPRIMA PRONTA PER APPROVAZIONE ===');
  console.log('Titolo: ' + sm.title);
  console.log('Contenuti visibili:');
  for (const t of sm.contents) console.log('  - ' + t);
  if (sm.form) {
    console.log('Form: campi [' + sm.form.fields.join(', ') + '] -> conferma: "' + sm.form.confirmation + '"');
  }
  console.log('Mobile verificato: ' + (sm.mobileChecked ? 'si' : 'no'));
  if (sm.manualConfirm.length) {
    console.log('Da confermare a mano (soggettivi):');
    for (const m of sm.manualConfirm) console.log('  - ' + m);
  }
  console.log('\nQA: ' + (pkg.value.report.buildSucceeded ? 'verde' : 'ROSSA') + ' (correzioni: ' + pkg.value.iterations + ')');
  console.log('Apri:  demo/preview-output/' + s.id + '.html  (e' + ' approva, oppure chiedi modifiche)');
} finally {
  await browser.close();
  server.close();
}
