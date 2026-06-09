/**
 * Test Fase 3.2 — Fast Preview Mode, Step 1.
 * Offline/deterministici: store su fs temporaneo, LLM/generatore/QA finti.
 * Lancio: npx tsx --test test/fastPreview.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, type Result, type ProjectSpec, type SitePage, type QaReport, type LLMProvider, type LLMResponse } from '../src/core/index.js';
import { makeFileSiteStore } from '../src/project/siteStore.js';
import { createHome, completePages, awaitPagesReady, finalizePendingRoutes, createProject, getProject, finalizeProject, refineHome, isPlaceholderHtml, pendingRoutesOf } from '../src/project/siteSession.js';
import type { SiteGenerator } from '../src/adapters/anthropic/siteGenerator.js';
import type { IntakeClassifier } from '../src/intake/sitePlanner.js';

function fixedLlm(text: string): LLMProvider {
  return { name: 'fake', async complete(): Promise<Result<LLMResponse>> { return ok({ text }); } };
}
function slowLlm(text: string, delayMs: number): LLMProvider {
  return { name: 'slow', async complete(): Promise<Result<LLMResponse>> { await new Promise((r) => setTimeout(r, delayMs)); return ok({ text }); } };
}
const classifier: IntakeClassifier = {
  async classify(statement: string) {
    const text = statement.match(/"([^"]+)"/)?.[1] ?? statement;
    return ok({ kind: 'content-present', route: '/', text } as const);
  },
};
const greenQa = async (): Promise<Result<QaReport>> =>
  ok({ level1: [{ criterionId: 'L1', kind: 'route-loads', passed: true }], level2: [], flagged: [], buildSucceeded: true });

// Piano a 3 pagine: home + 2 interne.
const PLAN = JSON.stringify({
  title: 'Studio', category: 'business-landing', pages: [
    { route: '/', label: 'Home', statements: ['Mostra "Benvenuto"'] },
    { route: '/servizi', label: 'Servizi', statements: ['Mostra "Consulenza"'] },
    { route: '/contatti', label: 'Contatti', statements: ['Mostra "Scrivici"'] },
  ],
});

// Generatore route-aware: una pagina reale per ogni route richiesta. La home porta
// emoji + data-count per verificare il cleanup.
function routeGenerator(): SiteGenerator {
  const pages = (spec: ProjectSpec, routes: readonly { route: string; label?: string }[]): SitePage[] =>
    routes.map((r) => ({
      route: r.route,
      html: `<!doctype html><html><body><h1>${spec.title} - ${r.label || r.route}</h1><p>REAL ${r.route} \u{1F3AF}</p><span data-count>10</span></body></html>`,
    }));
  return {
    async generate(spec, routes) { return ok(pages(spec, routes)); },
    async fix(spec, routes) { return ok(pages(spec, routes)); },
    async edit(_s, _r, current) { return ok([...current]); },
  };
}

// QA rossa: simula problemi estetici (non-blocking) come nel caso "ristorante di lusso".
const redQa = async (): Promise<Result<QaReport>> =>
  ok({ level1: [{ criterionId: 'L1', kind: 'contrast', passed: false, detail: 'contrasto non ideale' }], level2: [], flagged: [], buildSucceeded: false });

// Generatore con home renderizzabile e fix LENTO (per testare il timeout del fix in background).
function slowFixGenerator(fixDelayMs: number): SiteGenerator {
  const mk = (spec: ProjectSpec, routes: readonly { route: string; label?: string }[]): SitePage[] =>
    routes.map((r) => ({ route: r.route, html: `<!doctype html><html><body><main><h1>${spec.title}</h1><p>REAL ${r.route}</p></main></body></html>` }));
  return {
    async generate(spec, routes) { return ok(mk(spec, routes)); },
    async fix(spec, routes) { await new Promise((res) => setTimeout(res, fixDelayMs)); return ok(mk(spec, routes)); },
    async edit(_s, _r, current) { return ok([...current]); },
  };
}

// Generatore che registra le genOpts ricevute (per verificare maxTokens/logMetrics della home fast).
function capturingGenerator(): SiteGenerator & { lastMaxTokens?: number; lastLogMetrics?: boolean } {
  const mk = (spec: ProjectSpec, routes: readonly { route: string; label?: string }[]): SitePage[] =>
    routes.map((r) => ({ route: r.route, html: `<!doctype html><html><body><main><h1>${spec.title}</h1><p>REAL ${r.route}</p></main></body></html>` }));
  const g = {
    lastMaxTokens: undefined as number | undefined,
    lastLogMetrics: undefined as boolean | undefined,
    async generate(spec: ProjectSpec, routes: readonly { route: string; label?: string }[], genOpts?: { maxTokens?: number; logMetrics?: boolean }) { g.lastMaxTokens = genOpts?.maxTokens; g.lastLogMetrics = genOpts?.logMetrics; return ok(mk(spec, routes)); },
    async fix(spec: ProjectSpec, routes: readonly { route: string; label?: string }[]) { return ok(mk(spec, routes)); },
    async edit(_s: ProjectSpec, _r: readonly { route: string; label?: string }[], current: readonly SitePage[]) { return ok([...current]); },
  };
  return g as unknown as SiteGenerator & { lastMaxTokens?: number; lastLogMetrics?: boolean };
}

async function seedHome(dir: string) {
  const store = makeFileSiteStore(dir);
  const r = await createHome({ store, id: 's', ownerId: 'o', description: 'studio di consulenza strategica a Catanzaro', llm: fixedLlm(PLAN), classifier, generator: routeGenerator(), runQa: greenQa, review: false });
  assert.equal(r.ok, true);
  return { store, completion: (r as { value: { completion: unknown } }).value.completion as Parameters<typeof completePages>[0]['completion'] };
}

test('1+2: createHome genera solo la home, salva placeholder per le interne, pendingRoutes valorizzato', async () => {
  const { store } = await seedHome(mkdtempSync(join(tmpdir(), 'brik-fp1-')));
  const f = await store.load('s');
  const st = f.value!.state;
  const home = st.pages.find((p) => p.route === '/')!;
  const serv = st.pages.find((p) => p.route === '/servizi')!;
  assert.match(home.html, /REAL \//);                 // home reale
  assert.match(serv.html, /in preparazione/i);          // interna placeholder
  assert.doesNotMatch(serv.html, /REAL/);
  assert.deepEqual([...(st.pendingRoutes ?? [])].sort(), ['/contatti', '/servizi']);
});

test('3: completePages sostituisce i placeholder con pagine reali e svuota pendingRoutes', async () => {
  const { store, completion } = await seedHome(mkdtempSync(join(tmpdir(), 'brik-fp3-')));
  const r = await completePages({ store, id: 's', generator: routeGenerator(), runQa: greenQa, completion });
  assert.equal(r.ok, true);
  const st = (await store.load('s')).value!.state;
  assert.match(st.pages.find((p) => p.route === '/servizi')!.html, /REAL \/servizi/);
  assert.match(st.pages.find((p) => p.route === '/contatti')!.html, /REAL \/contatti/);
  assert.equal((st.pendingRoutes ?? []).length, 0);
});

test('4: completePages NON sovrascrive la home modificata dall\'utente', async () => {
  const { store, completion } = await seedHome(mkdtempSync(join(tmpdir(), 'brik-fp4-')));
  // Simulo una modifica utente alla home tra fase A e fase B.
  const f = await store.load('s');
  const edited = { ...f.value!.state, pages: f.value!.state.pages.map((p) => (p.route === '/' ? { ...p, html: '<h1>USER_EDIT home</h1>' } : p)) };
  await store.save({ ...f.value!, state: edited });
  await completePages({ store, id: 's', generator: routeGenerator(), runQa: greenQa, completion });
  const st = (await store.load('s')).value!.state;
  assert.match(st.pages.find((p) => p.route === '/')!.html, /USER_EDIT home/); // home preservata
  assert.match(st.pages.find((p) => p.route === '/servizi')!.html, /REAL \/servizi/); // interne completate
});

test('5: il cleanup gira sulla home prima del salvataggio (no emoji, no data-count)', async () => {
  const { store } = await seedHome(mkdtempSync(join(tmpdir(), 'brik-fp5-')));
  const home = (await store.load('s')).value!.state.pages.find((p) => p.route === '/')!;
  assert.doesNotMatch(home.html, /data-count/);
  assert.doesNotMatch(home.html, /[\u{1F000}-\u{1FAFF}]/u);
  assert.match(home.html, /REAL \//); // contenuto reale resta
});

test('6: awaitPagesReady — sito completo (pendingRoutes vuoto) → ready subito, senza attesa', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-fp6-'));
  const store = makeFileSiteStore(dir);
  const r = await createProject({ store, id: 's', ownerId: 'o', description: 'studio di consulenza', llm: fixedLlm(PLAN), classifier, generator: routeGenerator(), runQa: greenQa, review: false });
  assert.equal(r.ok, true);
  const gate = await awaitPagesReady({ store, id: 's', timeoutMs: 1000 });
  assert.deepEqual(gate, { ready: true, pendingRoutes: [], waited: false });
});

test('7: awaitPagesReady — attende il completamento in corso e poi pubblica', async () => {
  const { store, completion } = await seedHome(mkdtempSync(join(tmpdir(), 'brik-fp7-')));
  // Il completamento reale (sostituisce i placeholder) arriva durante l'attesa.
  setTimeout(() => { void completePages({ store, id: 's', generator: routeGenerator(), runQa: greenQa, completion }); }, 80);
  const gate = await awaitPagesReady({ store, id: 's', timeoutMs: 3000, sleepMs: 40 });
  assert.equal(gate.waited, true);
  assert.equal(gate.ready, true);
});

test('8: awaitPagesReady — se non completa entro il timeout → NON ready (publish bloccato)', async () => {
  const { store } = await seedHome(mkdtempSync(join(tmpdir(), 'brik-fp8-')));
  const gate = await awaitPagesReady({ store, id: 's', timeoutMs: 200, sleepMs: 50 });
  assert.equal(gate.ready, false);
  assert.equal(gate.waited, true);
  assert.ok(gate.pendingRoutes.length > 0);
});

test('9: finalizeProject disattivato (publish non rigenera creativamente)', async () => {
  const { store } = await seedHome(mkdtempSync(join(tmpdir(), 'brik-fp9-')));
  const r = await finalizeProject({ store, id: 's', llm: fixedLlm(PLAN), generator: routeGenerator(), runQa: greenQa, enabled: false });
  assert.equal(r.ok, true);
  assert.equal((r as { value: { regenerated: boolean } }).value.regenerated, false);
});

async function withPlanCap<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.BRIK_PLAN_CAP_MS;
  process.env.BRIK_PLAN_CAP_MS = String(ms);
  try { return await fn(); } finally { if (prev === undefined) delete process.env.BRIK_PLAN_CAP_MS; else process.env.BRIK_PLAN_CAP_MS = prev; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('3.2.5: finalizePendingRoutes genera le route pending e svuota pendingRoutes (publish-ready)', async () => {
  const { store } = await seedHome(mkdtempSync(join(tmpdir(), 'brik-fpr1-')));
  assert.equal(pendingRoutesOf((await store.load('s')).value!.state).length, 2);
  const r = await finalizePendingRoutes({ store, id: 's', generator: routeGenerator() });
  assert.equal(r.ok, true);
  const st = (await store.load('s')).value!.state;
  assert.equal(pendingRoutesOf(st).length, 0);
  assert.match(st.pages.find((p) => p.route === '/servizi')!.html, /REAL \/servizi/);
  assert.equal((r as { value: { generated: string[] } }).value.generated.length, 2);
});

test('3.2.5: finalizePendingRoutes — generate lento va in timeout, usa fallback ma TERMINA', async () => {
  const { store } = await seedHome(mkdtempSync(join(tmpdir(), 'brik-fpr2-')));
  const slowGen: SiteGenerator = {
    async generate(spec, routes) { await sleep(1500); return ok(routes.map((x) => ({ route: x.route, html: `<!doctype html><html><body><main><p>${spec.title} ${x.route}</p></main></body></html>` }))); },
    async fix(_s, routes) { return ok(routes.map((x) => ({ route: x.route, html: '<!doctype html><html><body><main>x</main></body></html>' }))); },
    async edit(_s, _r, current) { return ok([...current]); },
  };
  const r = await finalizePendingRoutes({ store, id: 's', generator: slowGen, perRouteTimeoutMs: 100, totalTimeoutMs: 8000 });
  assert.equal(r.ok, true);
  const st = (await store.load('s')).value!.state;
  assert.equal(pendingRoutesOf(st).length, 0);                 // tutte risolte (via fallback)
  assert.equal((r as { value: { fallback: string[] } }).value.fallback.length, 2);
  const serv = st.pages.find((p) => p.route === '/servizi')!;
  assert.equal(isPlaceholderHtml(serv.html), false);            // fallback NON e placeholder
  assert.match(serv.html, /Contenuto in arrivo|Torna alla home/);
});

test('3.2.5: finalizePendingRoutes — generate che fallisce usa fallback e TERMINA', async () => {
  const { store } = await seedHome(mkdtempSync(join(tmpdir(), 'brik-fpr3-')));
  const boom: SiteGenerator = {
    async generate() { throw new Error('boom'); },
    async fix(_s, routes) { return ok(routes.map((x) => ({ route: x.route, html: '<x/>' }))); },
    async edit(_s, _r, current) { return ok([...current]); },
  };
  const r = await finalizePendingRoutes({ store, id: 's', generator: boom });
  assert.equal(r.ok, true);
  assert.equal(pendingRoutesOf((await store.load('s')).value!.state).length, 0);
  assert.ok((r as { value: { fallback: string[] } }).value.fallback.length >= 1);
});

test('3.2.5: finalizePendingRoutes — nessuna route pending → ritorna subito', async () => {
  const store = makeFileSiteStore(mkdtempSync(join(tmpdir(), 'brik-fpr4-')));
  await createProject({ store, id: 's', ownerId: 'o', description: 'studio', llm: fixedLlm(PLAN), classifier, generator: routeGenerator(), runQa: greenQa, review: false });
  const r = await finalizePendingRoutes({ store, id: 's', generator: routeGenerator() });
  assert.equal((r as { value: { generated: string[]; fallback: string[] } }).value.generated.length, 0);
  assert.equal((r as { value: { generated: string[]; fallback: string[] } }).value.fallback.length, 0);
});

test('3.2.4: home fast passa il default BRIK_HOME_MAX_TOKENS (18000) e logMetrics al generatore', async () => {
  const store = makeFileSiteStore(mkdtempSync(join(tmpdir(), 'brik-mt1-')));
  const gen = capturingGenerator();
  const prev = process.env.BRIK_HOME_MAX_TOKENS; delete process.env.BRIK_HOME_MAX_TOKENS;
  try {
    const r = await createHome({ store, id: 's', ownerId: 'o', description: 'studio di consulenza', llm: fixedLlm(PLAN), classifier, generator: gen, runQa: greenQa, review: false });
    assert.equal(r.ok, true);
  } finally { if (prev !== undefined) process.env.BRIK_HOME_MAX_TOKENS = prev; }
  assert.equal(gen.lastMaxTokens, 18000);
  assert.equal(gen.lastLogMetrics, true);
});

test('3.2.4: BRIK_HOME_MAX_TOKENS override viene rispettato sulla home fast', async () => {
  const store = makeFileSiteStore(mkdtempSync(join(tmpdir(), 'brik-mt2-')));
  const gen = capturingGenerator();
  const prev = process.env.BRIK_HOME_MAX_TOKENS; process.env.BRIK_HOME_MAX_TOKENS = '9000';
  try {
    await createHome({ store, id: 's', ownerId: 'o', description: 'studio', llm: fixedLlm(PLAN), classifier, generator: gen, runQa: greenQa, review: false });
  } finally { if (prev === undefined) delete process.env.BRIK_HOME_MAX_TOKENS; else process.env.BRIK_HOME_MAX_TOKENS = prev; }
  assert.equal(gen.lastMaxTokens, 9000);
});

test('3.2.3: planner in timeout → sitemap minima sector-aware (non solo home) + pendingRoutes>0', async () => {
  const store = makeFileSiteStore(mkdtempSync(join(tmpdir(), 'brik-fb1-')));
  const r = await withPlanCap(20, () => createHome({ store, id: 's', ownerId: 'o', description: 'agenzia creativa di branding e design a Milano', llm: slowLlm(PLAN, 300), classifier, generator: routeGenerator(), runQa: greenQa, review: false }));
  assert.equal(r.ok, true);
  const st = (await store.load('s')).value!.state;
  const routes = st.routes.map((p) => p.route);
  assert.ok(routes.length > 1, 'non deve essere solo home');
  assert.ok(routes.includes('/portfolio'), 'creative_agency → /portfolio');
  const pend = [...(st.pendingRoutes ?? [])];
  assert.ok(pend.length > 0 && pend.includes('/portfolio'));
  assert.match(st.pages.find((p) => p.route === '/')!.html, /REAL \//);            // home reale
  assert.equal(isPlaceholderHtml(st.pages.find((p) => p.route === '/portfolio')!.html), true); // interna placeholder
});

test('3.2.3: dopo il fallback, completePages genera le interne e svuota pendingRoutes', async () => {
  const store = makeFileSiteStore(mkdtempSync(join(tmpdir(), 'brik-fb2-')));
  const r = await withPlanCap(20, () => createHome({ store, id: 's', ownerId: 'o', description: 'studio di consulenza strategica per PMI', llm: slowLlm(PLAN, 300), classifier, generator: routeGenerator(), runQa: greenQa, review: false }));
  const completion = (r as { value: { completion: Parameters<typeof completePages>[0]['completion'] } }).value.completion;
  assert.ok(completion.interiorRoutes.length > 0);
  assert.ok(completion.interiorRoutes.map((x) => x.route).includes('/metodo'), 'consulting → /metodo');
  await completePages({ store, id: 's', generator: routeGenerator(), runQa: greenQa, completion });
  const st = (await store.load('s')).value!.state;
  assert.equal(pendingRoutesOf(st).length, 0);
  assert.match(st.pages.find((p) => p.route === '/metodo')!.html, /REAL \/metodo/);
});

test('3.2.3: fallback generico quando il settore non e rilevabile', async () => {
  const store = makeFileSiteStore(mkdtempSync(join(tmpdir(), 'brik-fb3-')));
  const r = await withPlanCap(20, () => createHome({ store, id: 's', ownerId: 'o', description: 'piattaforma xyz qwerty generica senza settore', llm: slowLlm(PLAN, 300), classifier, generator: routeGenerator(), runQa: greenQa, review: false }));
  assert.equal(r.ok, true);
  const routes = (await store.load('s')).value!.state.routes.map((p) => p.route);
  assert.deepEqual(routes, ['/', '/servizi', '/chi-siamo', '/contatti']);
});

test('3.2.2: ristorante di lusso — preview_ready anche con QA rossa, NESSUN CREATE_NOT_GREEN', async () => {
  const store = makeFileSiteStore(mkdtempSync(join(tmpdir(), 'brik-resto1-')));
  const plan1 = JSON.stringify({ title: 'Locanda', category: 'business-landing', pages: [{ route: '/', label: 'Home', statements: ['Mostra "Benvenuto"'] }] });
  const r = await createHome({ store, id: 's', ownerId: 'o', description: 'sito per ristorante di lusso', llm: fixedLlm(plan1), classifier, generator: slowFixGenerator(50), runQa: redQa, review: false });
  assert.equal(r.ok, true); // la preview e pronta NONOSTANTE il QA rosso
  const home = (await store.load('s')).value!.state.pages.find((p) => p.route === '/')!;
  assert.match(home.html, /REAL \//);              // home reale e renderizzabile
  assert.equal(isPlaceholderHtml(home.html), false);
});

test('3.2.2: refineHome — fix lento va in timeout, preview invariata, previewIssues=true', async () => {
  const store = makeFileSiteStore(mkdtempSync(join(tmpdir(), 'brik-resto2-')));
  const plan1 = JSON.stringify({ title: 'Locanda', category: 'business-landing', pages: [{ route: '/', label: 'Home', statements: ['x'] }] });
  await createHome({ store, id: 's', ownerId: 'o', description: 'ristorante di lusso', llm: fixedLlm(plan1), classifier, generator: slowFixGenerator(1000), runQa: redQa, review: false });
  const st0 = (await store.load('s')).value!.state;
  const before = st0.pages.find((p) => p.route === '/')!.html;
  await refineHome({ store, id: 's', generator: slowFixGenerator(1000), runQa: redQa, spec: st0.spec, fixTimeoutMs: 40, maxFix: 1 });
  const st1 = (await store.load('s')).value!.state;
  assert.equal(st1.pages.find((p) => p.route === '/')!.html, before); // home INVARIATA (fix saltato)
  assert.equal((st1 as { previewIssues?: boolean }).previewIssues, true);
});

test('3.2.2: refineHome — se il fix porta al verde, aggiorna la home e azzera previewIssues', async () => {
  const store = makeFileSiteStore(mkdtempSync(join(tmpdir(), 'brik-resto3-')));
  const plan1 = JSON.stringify({ title: 'Locanda', category: 'business-landing', pages: [{ route: '/', label: 'Home', statements: ['x'] }] });
  let calls = 0;
  const flipQa = async (): Promise<Result<QaReport>> => { calls++; const green = calls >= 2; return ok({ level1: [{ criterionId: 'L1', kind: 'k', passed: green }], level2: [], flagged: [], buildSucceeded: green }); };
  const gen: SiteGenerator = {
    async generate(spec, routes) { return ok(routes.map((r) => ({ route: r.route, html: `<!doctype html><html><body><main><h1>${spec.title}</h1><p>V1 ${r.route}</p></main></body></html>` }))); },
    async fix(spec, routes) { return ok(routes.map((r) => ({ route: r.route, html: `<!doctype html><html><body><main><h1>${spec.title}</h1><p>V2 FIXED ${r.route}</p></main></body></html>` }))); },
    async edit(_s, _r, current) { return ok([...current]); },
  };
  await createHome({ store, id: 's', ownerId: 'o', description: 'ristorante', llm: fixedLlm(plan1), classifier, generator: gen, runQa: flipQa, review: false });
  const st0 = (await store.load('s')).value!.state;
  await refineHome({ store, id: 's', generator: gen, runQa: flipQa, spec: st0.spec, fixTimeoutMs: 5000, maxFix: 2 });
  const st1 = (await store.load('s')).value!.state;
  assert.match(st1.pages.find((p) => p.route === '/')!.html, /V2 FIXED/); // home aggiornata dal fix verde
  assert.notEqual((st1 as { previewIssues?: boolean }).previewIssues, true);
});

test('3.2.1: il placeholder e riconoscibile e il publish blocca anche se pendingRoutes (metadato) e vuoto', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-fp321-'));
  const { store } = await seedHome(dir);
  // Sabotaggio realistico: il metadato pendingRoutes viene azzerato per errore,
  // ma le pagine interne sono ancora placeholder. Il guard deve bloccare lo stesso.
  const f = await store.load('s');
  const home = f.value!.state.pages.find((p) => p.route === '/')!;
  const serv = f.value!.state.pages.find((p) => p.route === '/servizi')!;
  assert.equal(isPlaceholderHtml(home.html), false); // home reale
  assert.equal(isPlaceholderHtml(serv.html), true);   // interna placeholder
  await store.save({ ...f.value!, state: { ...f.value!.state, pendingRoutes: [] } }); // metadato azzerato
  const pend = pendingRoutesOf((await store.load('s')).value!.state);
  assert.ok(pend.includes('/servizi') && pend.includes('/contatti')); // ground truth dai placeholder
  const gate = await awaitPagesReady({ store, id: 's', timeoutMs: 200, sleepMs: 50 });
  assert.equal(gate.ready, false); // publish BLOCCATO: non pubblica placeholder
  assert.ok(gate.pendingRoutes.length > 0);
});

test('3.2.1: dopo completePages non restano placeholder e il publish e abilitato', async () => {
  const { store, completion } = await seedHome(mkdtempSync(join(tmpdir(), 'brik-fp321b-')));
  await completePages({ store, id: 's', generator: routeGenerator(), runQa: greenQa, completion });
  const st = (await store.load('s')).value!.state;
  assert.equal(st.pages.some((p) => isPlaceholderHtml(p.html)), false); // nessun placeholder residuo
  assert.equal(pendingRoutesOf(st).length, 0);
  const gate = await awaitPagesReady({ store, id: 's', timeoutMs: 500 });
  assert.deepEqual(gate, { ready: true, pendingRoutes: [], waited: false });
});

test('10: il contratto di polling vede preview con home disponibile e pendingRoutes', async () => {
  const { store } = await seedHome(mkdtempSync(join(tmpdir(), 'brik-fp10-')));
  const pj = await getProject(store, 's');
  assert.equal(pj.ok, true);
  const st = pj.value!;
  assert.equal(st.status, 'preview');
  assert.match(st.pages.find((p) => p.route === '/')!.html, /REAL \//); // home pronta
  assert.ok((st.pendingRoutes ?? []).length > 0);                        // interne ancora in preparazione
});
