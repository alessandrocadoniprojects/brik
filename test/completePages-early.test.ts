/**
 * Test deterministico del RILASCIO ANTICIPATO in completePages (fix publish).
 * Offline: mock generator/QA, niente rete ne LLM. Verifica che:
 *  - le route interne diventano REALI e pendingRoutes si svuota DOPO la prima
 *    generazione e PRIMA che il loop QA/fix finisca (= sito pubblicabile presto);
 *  - generate() viene chiamato UNA sola volta (niente doppia generazione);
 *  - le versioni rifinite dal fix atterrano comunque nello store alla fine;
 *  - la home non viene mai toccata.
 *
 * Lancio: npx tsx --test test/completePages-early.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, type ProjectSpec, type SitePage, type QaReport } from '../src/core/index.js';
import { completePages, isPlaceholderHtml, type CompletionPlan, type QaForSite } from '../src/project/siteSession.js';
import type { SiteStore } from '../src/project/siteStore.js';
import type { SiteFile, SiteState } from '../src/project/siteTypes.js';
import type { SiteGenerator, RouteInfo } from '../src/adapters/anthropic/siteGenerator.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const realHtml = (tag: string) => `<!doctype html><html lang="it"><body><main><h1>${tag}</h1><p>contenuto reale</p></main></body></html>`;
const placeholderHtml = (label: string) => `<!doctype html><html lang="it" data-brik-pending="1"><body><main><h1>${label}</h1></main></body></html>`;

function memStore(initial: SiteFile): { store: SiteStore; current: () => SiteState } {
  let file = initial;
  return {
    store: {
      async load() { return ok(file); },
      async save(f: SiteFile) { file = f; return ok(undefined); },
    },
    current: () => file.state,
  };
}

test('completePages: rilascio anticipato — pending svuotato prima del fix, generate una volta, rifinitura finale applicata', async () => {
  const interiorRoutes: RouteInfo[] = [
    { route: '/a', label: 'A' },
    { route: '/b', label: 'B' },
    { route: '/c', label: 'C' },
  ];
  const spec = { id: 'p1', ownerId: 'u1', category: 'website', title: 'T', description: 'D', criteria: [] } as unknown as ProjectSpec;

  const seed: SiteState = {
    id: 'p1', spec, statements: [],
    routes: [{ route: '/', label: 'Home' }, ...interiorRoutes],
    pages: [
      { route: '/', html: realHtml('home') },
      { route: '/a', html: placeholderHtml('A') },
      { route: '/b', html: placeholderHtml('B') },
      { route: '/c', html: placeholderHtml('C') },
    ],
    status: 'preview', version: 1, updatedAt: new Date().toISOString(),
    pendingRoutes: ['/a', '/b', '/c'],
  };
  const { store, current } = memStore({ schemaVersion: 2, state: seed, history: [] });

  let genCount = 0;
  let fixDone = false;
  const generator: SiteGenerator = {
    async generate(_s, routes) {
      genCount += 1;
      return ok(routes.map((r) => ({ route: r.route, html: realHtml('gen ' + r.route) })));
    },
    async fix(_s, routes) {
      await sleep(250); // il fix e' lento: il rilascio anticipato deve avvenire ben prima
      fixDone = true;
      return ok(routes.map((r) => ({ route: r.route, html: realHtml('REFINED ' + r.route) })));
    },
    async edit(_s, _r, current) { return ok([...current]); },
  };

  let qaCalls = 0;
  const runQa: QaForSite = async () => {
    qaCalls += 1;
    const green = qaCalls > 1; // qa#0 rossa -> forza UN fix; poi verde
    const report: QaReport = {
      level1: [{ criterionId: 'render', kind: 'render', passed: green, ...(green ? {} : { detail: 'forzato' }) }],
      level2: [], flagged: [], buildSucceeded: green,
    };
    return ok(report);
  };

  const completion: CompletionPlan = { spec, interiorRoutes, maxRepairs: 2, creativeNotes: [] };

  // Avvio SENZA await: osservo lo stato intermedio mentre il fix e' ancora in corso.
  const p = completePages({ store, id: 'p1', generator, runQa, completion });

  const deadline = Date.now() + 2000;
  while ((current().pendingRoutes ?? []).length > 0 && Date.now() < deadline) {
    await sleep(5);
  }

  // (1) pending svuotato + pagine reali, PRIMA che il fix finisca.
  assert.equal((current().pendingRoutes ?? []).length, 0, 'pendingRoutes deve essere vuoto dopo il rilascio anticipato');
  assert.equal(fixDone, false, 'il rilascio deve avvenire PRIMA della fine del fix');
  for (const r of ['/a', '/b', '/c']) {
    const pg = current().pages.find((x) => x.route === r);
    assert.ok(pg && !isPlaceholderHtml(pg.html), `${r} non deve piu essere placeholder`);
  }

  const res = await p;
  assert.ok(res.ok, 'completePages deve riuscire');

  // (2) niente doppia generazione.
  assert.equal(genCount, 1, 'generate() deve essere chiamato una sola volta');

  // (3) versioni rifinite atterrate, home intatta, pending vuoto.
  for (const r of ['/a', '/b', '/c']) {
    const pg = current().pages.find((x) => x.route === r);
    assert.ok(pg && /REFINED/.test(pg.html), `${r} deve avere la versione rifinita finale`);
  }
  const home = current().pages.find((x) => x.route === '/');
  assert.ok(home && /home/.test(home.html), 'la home non deve essere toccata');
  assert.equal((current().pendingRoutes ?? []).length, 0, 'pendingRoutes finale vuoto');
});
