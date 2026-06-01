/**
 * DIAGNOSTICA portfolio — confronta i CRITERI del classificatore reale con
 * l'HTML reale già su disco, e gira la QA stampando ogni check col dettaglio.
 *
 * Lancio: npx tsx --env-file=.env demo/diag-portfolio.ts
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { makePlaywrightQaRunner } from '../src/qa/playwrightRunner.js';
import { makeAnthropicClassifier, buildCriteria } from '../src/intake/index.js';
import { SCENARIOS } from '../src/eval/scenarios.js';
import type { ProjectSpec } from '../src/core/index.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error('Manca ANTHROPIC_API_KEY (serve per il classificatore).'); process.exit(1); }

const s = SCENARIOS.find((x) => x.id === 'portfolio-photographer');
if (!s) { console.error('scenario non trovato'); process.exit(1); }

const html = readFileSync(new URL('./eval-output/portfolio-photographer.html', import.meta.url), 'utf8');

const classifier = makeAnthropicClassifier({ apiKey: key });
const crit = await buildCriteria(
  { statements: s.statements, context: { category: s.category, knownRoutes: s.knownRoutes } },
  classifier,
);
if (!crit.ok) { console.error('intake fallito:', crit.error.message); process.exit(1); }

console.log('=== CRITERI prodotti dal classificatore ===');
for (const c of crit.value) {
  if (!c.check) { console.log('- [SEGNALATO, nessun check] ', c.statement); continue; }
  const k = c.check;
  if (k.kind === 'content-present') console.log(`- content-present  route=${k.route}  text=${JSON.stringify(k.text)}`);
  else if (k.kind === 'form-submission') console.log(`- form-submission  route=${k.route}  fields=${JSON.stringify(k.fields.map(f => f.label))}  confirm=${JSON.stringify(k.confirmationText)}`);
  else if (k.kind === 'responsive') console.log(`- responsive       route=${k.route}`);
  else if (k.kind === 'route-loads') console.log(`- route-loads      route=${k.route}`);
  else if (k.kind === 'navigation') console.log(`- navigation       from=${k.fromRoute} link=${JSON.stringify(k.linkText)} -> ${k.toRoutePattern}`);
}

const server = createServer((req, res) => {
  const u = (req.url ?? '/').split('?')[0];
  if (u === '/' || u === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }
  else { res.writeHead(404); res.end('not found'); }
});
await new Promise<void>((r) => server.listen(0, r));
const baseUrl = 'http://localhost:' + (server.address() as AddressInfo).port;

const spec: ProjectSpec = {
  id: s.id, ownerId: 'diag', category: s.category, title: s.title, description: s.description, criteria: crit.value,
};

const browser = await chromium.launch();
try {
  const report = await makePlaywrightQaRunner(baseUrl, s.knownRoutes, { browser }).run(
    { specId: spec.id, templateId: 'diag', files: [] }, spec,
  );
  console.log('\n=== ESITO QA su HTML reale ===');
  if (!report.ok) { console.log('QA error:', report.error.code, report.error.message); }
  else {
    const g = report.value;
    const line = (c: { passed: boolean; kind: string; criterionId: string; detail?: string }) =>
      (c.passed ? 'OK   ' : 'FAIL ') + c.kind.padEnd(16) + c.criterionId.padEnd(8) + (c.detail ? ':: ' + c.detail : '');
    for (const c of g.level1) console.log(line(c));
    for (const c of g.level2) console.log(line(c));
    console.log('\nbuildSucceeded:', g.buildSucceeded);
  }
} finally { await browser.close(); server.close(); }
