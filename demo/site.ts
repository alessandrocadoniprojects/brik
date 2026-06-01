/**
 * DEMO multi-pagina (Fase 3 / tappa 1).
 *
 * Spec costruito a mano (3 pagine): Home / Servizi / Contatti, con navigazione,
 * form su Contatti, contenuti per-pagina e mobile. Genera l'MPA, serve le route,
 * fa girare la QA multi-route (incluso il check navigation) e ripara fino al
 * verde. Scrive le pagine in demo/site-output/.
 *
 * Lancio: npx tsx --env-file=.env demo/site.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { makeAnthropicLLM } from '../src/adapters/index.js';
import { makeAnthropicSiteGenerator, type RouteInfo } from '../src/adapters/anthropic/siteGenerator.js';
import { makePlaywrightQaRunner } from '../src/qa/playwrightRunner.js';
import { repairSite } from '../src/orchestrator/repairSite.js';
import type { ProjectSpec, SitePage } from '../src/core/index.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Manca ANTHROPIC_API_KEY.');
  process.exit(1);
}

const routes: RouteInfo[] = [
  { route: '/', label: 'Home' },
  { route: '/servizi', label: 'Servizi' },
  { route: '/contatti', label: 'Contatti' },
];

const spec: ProjectSpec = {
  id: 'multipage-studio',
  ownerId: 'demo',
  category: 'business-landing',
  title: 'Studio Verde Architetti',
  description: 'Studio di architettura, sito multi-pagina.',
  criteria: [
    { id: 'c1', statement: 'Titolo in home', confirmed: true, check: { kind: 'content-present', route: '/', text: 'Studio Verde Architetti' } },
    { id: 'c2', statement: 'Tagline in home', confirmed: true, check: { kind: 'content-present', route: '/', text: 'Progettiamo spazi che respirano' } },
    { id: 'c3', statement: 'Servizio in pagina Servizi', confirmed: true, check: { kind: 'content-present', route: '/servizi', text: 'Ristrutturazioni' } },
    { id: 'c4', statement: 'Servizio in pagina Servizi', confirmed: true, check: { kind: 'content-present', route: '/servizi', text: 'Interior design' } },
    { id: 'c5', statement: 'Navigazione verso Contatti', confirmed: true, check: { kind: 'navigation', fromRoute: '/', linkText: 'Contatti', toRoutePattern: '/contatti' } },
    {
      id: 'c6',
      statement: 'Form in pagina Contatti',
      confirmed: true,
      check: {
        kind: 'form-submission',
        route: '/contatti',
        fields: [
          { label: 'Nome', value: 'x' },
          { label: 'Email', value: 'x' },
          { label: 'Messaggio', value: 'x' },
        ],
        expect: 'confirmation-visible',
        confirmationText: 'Messaggio inviato, grazie',
      },
    },
    { id: 'c7', statement: 'Home mobile', confirmed: true, check: { kind: 'responsive', route: '/' } },
    { id: 'c8', statement: 'Contatti mobile', confirmed: true, check: { kind: 'responsive', route: '/contatti' } },
  ],
};

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

console.log('Genero il sito multi-pagina (' + routes.map((r) => r.route).join(', ') + ')...');

try {
  const generator = makeAnthropicSiteGenerator(llmFrom(key));

  const runQa = (pages: readonly SitePage[]) => {
    pagesMap.clear();
    for (const p of pages) pagesMap.set(p.route, p.html);
    return makePlaywrightQaRunner(baseUrl, routes.map((r) => r.route), { browser }).run(
      { specId: spec.id, templateId: 'site', files: [] },
      spec,
    );
  };

  const res = await repairSite({ spec, routes, generator, runQa, maxRepairs: 3 });
  if (!res.ok) {
    console.error('site: ' + res.error.message);
    process.exit(1);
  }

  const outDir = new URL('./site-output/', import.meta.url);
  mkdirSync(outDir, { recursive: true });
  for (const p of res.value.pages) writeFileSync(new URL(fileFor(p.route), outDir), p.html);

  const g = res.value.report;
  const line = (c: { passed: boolean; kind: string; criterionId: string; detail?: string }) =>
    (c.passed ? 'OK   ' : 'FAIL ') + c.kind.padEnd(16) + c.criterionId.padEnd(6) + (c.detail ? ':: ' + c.detail : '');
  console.log('\n=== QA MULTI-PAGINA ===');
  for (const c of g.level1) console.log(line(c));
  for (const c of g.level2) console.log(line(c));
  console.log('\nbuildSucceeded: ' + g.buildSucceeded + ' (correzioni: ' + res.value.iterations + ')');
  console.log('Pagine in demo/site-output/ : ' + res.value.pages.map((p) => fileFor(p.route)).join(', '));
  console.log('Apri demo/site-output/index.html');
} finally {
  await browser.close();
  server.close();
}

function llmFrom(apiKey: string) {
  return makeAnthropicLLM({ apiKey });
}
