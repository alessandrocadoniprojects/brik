/**
 * DEMO "crea il sito parlando" (Fase 3 / tappa 3).
 *
 * Da una descrizione in linguaggio naturale: pianifica la struttura (pagine +
 * requisiti per pagina + navigazione), genera l'MPA, fa girare la QA multi-route
 * e ripara fino al verde. Scrive le pagine in demo/plan-output/.
 *
 * Uso:
 *   npx tsx --env-file=.env demo/plan.ts "Voglio il sito di una pizzeria con home, il menu delle pizze, e una pagina contatti con form (conferma 'Grazie, a presto')"
 *   npx tsx --env-file=.env demo/plan.ts            (usa un esempio)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { makeAnthropicLLM } from '../src/adapters/index.js';
import { makeAnthropicSiteGenerator } from '../src/adapters/anthropic/siteGenerator.js';
import { makeAnthropicClassifier } from '../src/intake/index.js';
import { planSite } from '../src/intake/sitePlanner.js';
import { makePlaywrightQaRunner } from '../src/qa/playwrightRunner.js';
import { repairSite } from '../src/orchestrator/repairSite.js';
import type { SitePage } from '../src/core/index.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Manca ANTHROPIC_API_KEY.');
  process.exit(1);
}

const description =
  process.argv.slice(2).join(' ') ||
  'Voglio il sito di una pizzeria "Da Ciro": una home con lo slogan "La vera pizza napoletana", una pagina con il menu (Margherita, Marinara, Diavola) e una pagina contatti con un form (nome, email, messaggio) che dopo l\'invio mostra "Grazie, ti rispondiamo presto".';

const llm = makeAnthropicLLM({ apiKey: key });
const classifier = makeAnthropicClassifier({ apiKey: key });

console.log('Descrizione:\n  ' + description + '\n');
console.log('Pianifico la struttura...');

const plan = await planSite({ id: 'sito-da-chat', ownerId: 'demo', description, llm, classifier });
if (!plan.ok) {
  console.error('pianificazione: ' + plan.error.message);
  process.exit(1);
}

console.log('\n=== STRUTTURA PIANIFICATA ===');
console.log('Titolo: ' + plan.value.spec.title + '  | categoria: ' + plan.value.spec.category);
console.log('Pagine: ' + plan.value.routes.map((r) => r.label + ' (' + r.route + ')').join(', '));
console.log('Criteri per pagina:');
for (const r of plan.value.routes) {
  const items = plan.value.spec.criteria.filter((c) => {
    const k = c.check;
    if (!k) return false;
    if (k.kind === 'navigation') return k.fromRoute === r.route;
    return k.route === r.route;
  });
  console.log('  ' + r.route + ' :');
  for (const c of items) {
    const k = c.check!;
    if (k.kind === 'content-present') console.log('    - testo "' + k.text + '"');
    else if (k.kind === 'form-submission') console.log('    - form [' + k.fields.map((f) => f.label).join(', ') + '] -> "' + k.confirmationText + '"');
    else if (k.kind === 'responsive') console.log('    - mobile');
    else if (k.kind === 'navigation') console.log('    - link "' + k.linkText + '" -> ' + k.toRoutePattern);
  }
}

const pagesMap = new Map<string, string>();
const server = createServer((req, res) => {
  const u = (req.url ?? '/').split('?')[0];
  const k = u === '/index.html' ? '/' : u;
  const html = pagesMap.get(k);
  if (html !== undefined) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});
await new Promise<void>((r) => server.listen(0, r));
const baseUrl = 'http://localhost:' + (server.address() as AddressInfo).port;
const browser = await chromium.launch();

function fileFor(route: string): string {
  if (route === '/') return 'index.html';
  return route.replace(/^\//, '').replace(/\//g, '-') + '.html';
}

console.log('\nGenero e verifico...');

try {
  const generator = makeAnthropicSiteGenerator(llm);
  const runQa = (pages: readonly SitePage[]) => {
    pagesMap.clear();
    for (const p of pages) pagesMap.set(p.route, p.html);
    return makePlaywrightQaRunner(baseUrl, plan.value.routes.map((r) => r.route), { browser }).run(
      { specId: plan.value.spec.id, templateId: 'plan', files: [] },
      plan.value.spec,
    );
  };

  const res = await repairSite({ spec: plan.value.spec, routes: plan.value.routes, generator, runQa, maxRepairs: 3 });
  if (!res.ok) {
    console.error('build: ' + res.error.message);
    process.exit(1);
  }

  const outDir = new URL('./plan-output/', import.meta.url);
  mkdirSync(outDir, { recursive: true });
  for (const p of res.value.pages) writeFileSync(new URL(fileFor(p.route), outDir), p.html);

  const g = res.value.report;
  const fails = [...g.level1, ...g.level2].filter((c) => !c.passed);
  console.log('\n=== QA ===');
  console.log('Route verificate: ' + g.level1.length + ' | criteri: ' + g.level2.length);
  if (fails.length === 0) console.log('Tutto verde.');
  else for (const c of fails) console.log('  FAIL [' + c.kind + '] ' + c.criterionId + (c.detail ? ' :: ' + c.detail : ''));
  console.log('buildSucceeded: ' + g.buildSucceeded + ' (correzioni: ' + res.value.iterations + ')');
  console.log('Pagine: ' + res.value.pages.map((p) => fileFor(p.route)).join(', '));
  console.log('Apri demo/plan-output/index.html');
} finally {
  await browser.close();
  server.close();
}
