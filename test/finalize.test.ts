/**
 * Test della separazione Preview / Finalizzazione premium.
 * Offline e deterministici: store su filesystem temporaneo, LLM/generatore/QA finti.
 * Lancio: npx tsx --test test/finalize.test.ts
 *
 * Verifico i comportamenti che contano:
 *  - sotto soglia → UNA rigenerazione, pagine migliorate persistite;
 *  - sopra soglia → nessuna rigenerazione;
 *  - rigenerazione non verde → fallback alla preview (pagine invariate);
 *  - finalizzazione disattivata → nessuna azione;
 *  - la PREVIEW (createProject) non rigenera mai, nemmeno se il direttore boccia.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, err, appError, type Result, type ProjectSpec, type SitePage, type QaReport, type LLMProvider, type LLMResponse } from '../src/core/index.js';
import { makeFileSiteStore } from '../src/project/siteStore.js';
import { createProject, finalizeProject } from '../src/project/siteSession.js';
import type { SiteGenerator, RouteInfo } from '../src/adapters/anthropic/siteGenerator.js';
import type { IntakeClassifier } from '../src/intake/sitePlanner.js';

// --- fakes minimi ------------------------------------------------------------

// LLM che risponde con un testo fisso (usato sia dal planner che dal direttore).
function fixedLlm(text: string): LLMProvider {
  return { name: 'fake', async complete(): Promise<Result<LLMResponse>> { return ok({ text }); } };
}

// Classificatore banale: ogni frase diventa un check content-present.
const classifier: IntakeClassifier = {
  async classify(statement: string) {
    const text = statement.match(/"([^"]+)"/)?.[1] ?? statement;
    return ok({ kind: 'content-present', route: '/', text } as const);
  },
};

// Piano minimo a una pagina (quello che il planner LLM "restituisce").
const PLAN = JSON.stringify({ title: 'Studio Dentistico', category: 'business-landing', pages: [{ route: '/', label: 'Home', statements: ['Mostra "Benvenuto"'] }] });

// QA sempre verde: ci interessa il flusso di finalizzazione, non la QA.
const greenQa = async (): Promise<Result<QaReport>> =>
  ok({ level1: [{ criterionId: 'L1', kind: 'route-loads', passed: true }], level2: [], flagged: [], buildSucceeded: true });

// Generatore che marca l'HTML così distinguiamo preview da versione rigenerata.
function taggingGenerator(tag: string): SiteGenerator {
  const page = (spec: ProjectSpec): SitePage[] => [{ route: '/', html: `<!doctype html><html><body><h1>${spec.title}</h1><p>${tag}</p></body></html>` }];
  return {
    async generate(spec) { return ok(page(spec)); },
    async fix(spec) { return ok(page(spec)); },
    async edit(_s, _r, current) { return ok([...current]); },
  };
}

// Verdetti del direttore pilotati (JSON che reviewSite sa interpretare).
const PASS = JSON.stringify({ scores: full(9), overall: 9, decision: 'pass', issues: [] });
const FAIL = JSON.stringify({ scores: full(4), overall: 4, decision: 'regenerate', issues: ['apri con piu atmosfera', 'riduci la densita'] });
function full(n: number) { return { prestige: n, industry_fit: n, visual_hierarchy: n, restraint: n, conversion_clarity: n, anti_cliche: n, copy_quality: n, theme_alignment: n }; }

async function seedPreview(dir: string, llmText: string) {
  const store = makeFileSiteStore(dir);
  // createProject usa il planner (LLM=PLAN) e il direttore (qui irrilevante perché review è log-only).
  const created = await createProject({
    store, id: 's', ownerId: 'o', description: 'studio dentistico premium a Milano',
    llm: fixedLlm(PLAN), classifier, generator: taggingGenerator('preview'), runQa: greenQa, review: false,
  });
  assert.equal(created.ok, true);
  return store;
}

// --- test --------------------------------------------------------------------

test('preview: createProject NON rigenera e salva la creative_direction', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-fin-prev-'));
  const store = await seedPreview(dir, PLAN);
  const f = await store.load('s');
  assert.equal(f.ok && !!f.value, true);
  const st = (f as { value: { state: { pages: SitePage[]; creativeDirection?: unknown; version: number } } }).value.state;
  assert.match(st.pages[0]!.html, /preview/);     // è la versione preview
  assert.equal(st.version, 1);                     // nessuna rigenerazione
  assert.ok(st.creativeDirection);                 // direzione creativa salvata
});

test('preview: la review in background NON blocca createProject (preview persistita comunque)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-fin-bg-'));
  const store = makeFileSiteStore(dir);
  // review ATTIVA (review non passato => default abilitato). La review gira in background:
  // createProject deve ritornare e persistere senza attenderla. Se aspettasse, con questo
  // LLM finto la chiamata di review tornerebbe comunque, ma il punto e che non deve bloccare.
  const created = await createProject({
    store, id: 'bg', ownerId: 'o', description: 'studio dentistico premium a Milano',
    llm: fixedLlm(PLAN), classifier, generator: taggingGenerator('preview'), runQa: greenQa,
  });
  assert.equal(created.ok, true);
  const f = await store.load('bg');
  const st = (f as { value: { state: { pages: SitePage[]; version: number; status: string } } }).value.state;
  assert.match(st.pages[0]!.html, /preview/); // preview servita
  assert.equal(st.version, 1);                // nessuna rigenerazione in preview
  assert.equal(st.status, 'preview');
});

test('finalize sotto soglia → UNA rigenerazione, pagine migliorate persistite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-fin-regen-'));
  const store = await seedPreview(dir, PLAN);
  const r = await finalizeProject({ store, id: 's', llm: fixedLlm(FAIL), generator: taggingGenerator('premium'), runQa: greenQa, reviewMinScore: 7, enabled: true });
  assert.equal(r.ok, true);
  assert.equal((r as { value: { regenerated: boolean } }).value.regenerated, true);
  const f = await store.load('s');
  const st = (f as { value: { state: { pages: SitePage[]; version: number } } }).value.state;
  assert.match(st.pages[0]!.html, /premium/);      // versione rigenerata persistita
  assert.equal(st.version, 2);                     // versione incrementata
});

test('finalize sopra soglia → nessuna rigenerazione, preview invariata', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-fin-skip-'));
  const store = await seedPreview(dir, PLAN);
  const r = await finalizeProject({ store, id: 's', llm: fixedLlm(PASS), generator: taggingGenerator('premium'), runQa: greenQa, reviewMinScore: 7, enabled: true });
  assert.equal((r as { value: { regenerated: boolean } }).value.regenerated, false);
  const f = await store.load('s');
  const st = (f as { value: { state: { pages: SitePage[]; version: number } } }).value.state;
  assert.match(st.pages[0]!.html, /preview/);      // resta la preview
  assert.equal(st.version, 1);
});

test('finalize con rigenerazione NON verde → fallback alla preview', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-fin-fallback-'));
  const store = await seedPreview(dir, PLAN);
  const redQa = async (): Promise<Result<QaReport>> => ok({ level1: [{ criterionId: 'L1', kind: 'route-loads', passed: false, detail: 'rotto' }], level2: [], flagged: [], buildSucceeded: false });
  const r = await finalizeProject({ store, id: 's', llm: fixedLlm(FAIL), generator: taggingGenerator('premium'), runQa: redQa, reviewMinScore: 7, enabled: true });
  assert.equal((r as { value: { regenerated: boolean } }).value.regenerated, false);
  const f = await store.load('s');
  const st = (f as { value: { state: { pages: SitePage[]; version: number } } }).value.state;
  assert.match(st.pages[0]!.html, /preview/);      // la preview resta disponibile
  assert.equal(st.version, 1);
});

// --- Fase 3 Step 1: cleanup in preview + WYSIWYG al publish --------------------

// Generatore "sporco": emette emoji e data-count, come farebbe un LLM non perfetto.
function dirtyGenerator(): SiteGenerator {
  const page = (spec: ProjectSpec): SitePage[] => [{
    route: '/',
    html: `<!doctype html><html><body><h1>${spec.title} \u{1F3E2}</h1><div class="n"><span data-count>240</span><span class="plus">+</span></div><a class="tlink">Lavori <span class="arr">\u2192</span></a></body></html>`,
  }];
  return {
    async generate(spec) { return ok(page(spec)); },
    async fix(spec) { return ok(page(spec)); },
    async edit(_s, _r, current) { return ok([...current]); },
  };
}

test('5: createProject salva la preview GIÀ ripulita (no emoji, no data-count, numero statico)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-clean-'));
  const store = makeFileSiteStore(dir);
  const created = await createProject({
    store, id: 's', ownerId: 'o', description: 'studio dentistico premium a Milano',
    llm: fixedLlm(PLAN), classifier, generator: dirtyGenerator(), runQa: greenQa, review: false,
  });
  assert.equal(created.ok, true);
  const f = await store.load('s');
  assert.equal(f.ok, true);
  const html = f.value!.state.pages[0]!.html;
  assert.doesNotMatch(html, /data-count/);                 // data-count rimosso
  assert.doesNotMatch(html, /[\u{1F000}-\u{1FAFF}]/u);      // emoji rimosse
  assert.match(html, /<span>240<\/span>/);                 // numero statico preservato
  assert.match(html, /\u2192/);                             // freccia CTA preservata (no over-strip)
});

test('7: publish WYSIWYG — con finalize OFF lo store NON cambia (si pubblica la versione vista)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-wysiwyg-'));
  const store = await seedPreview(dir, PLAN);
  const before = (await store.load('s')).value!.state.pages.map((p) => p.html);
  // Anche se il direttore boccerebbe (FAIL), con enabled:false non si rigenera nulla.
  const r = await finalizeProject({ store, id: 's', llm: fixedLlm(FAIL), generator: taggingGenerator('premium'), runQa: greenQa, reviewMinScore: 7, enabled: false });
  assert.equal(r.ok, true);
  assert.equal(r.value.regenerated, false);
  const after = (await store.load('s')).value!.state.pages.map((p) => p.html);
  assert.deepEqual(after, before); // byte-identiche: ciò che si vede è ciò che si pubblica
});

test('finalize disattivata → nessuna azione', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-fin-off-'));
  const store = await seedPreview(dir, PLAN);
  const r = await finalizeProject({ store, id: 's', llm: fixedLlm(FAIL), generator: taggingGenerator('premium'), runQa: greenQa, reviewMinScore: 7, enabled: false });
  assert.equal((r as { value: { finalized: boolean; regenerated: boolean } }).value.finalized, false);
  const f = await store.load('s');
  const st = (f as { value: { state: { pages: SitePage[] } } }).value.state;
  assert.match(st.pages[0]!.html, /preview/);
});
