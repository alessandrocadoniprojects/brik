/**
 * Test deterministici (offline: mock LLM/QA, niente rete ne browser).
 * Coprono scanner, pianificatore (guardrail), store+migrazione e l'intera
 * macchina a stati multi-pagina.
 *
 * Lancio: npx tsx --test test/site.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

import { ok, err, appError, type Result, type ProjectSpec, type SitePage, type QaReport } from '../src/core/index.js';
import { makeBasicSecurityScanner } from '../src/security/scanner.js';
import { planSite, extractQuoted, pickConfirmation, extractLabeledLists } from '../src/intake/sitePlanner.js';
import { makeFileSiteStore } from '../src/project/siteStore.js';
import { scanSite, summarizeSite } from '../src/project/site.js';
import { planEdit } from '../src/intake/editPlanner.js';
import {
  createProject,
  getProject,
  editProject,
  approveProject,
  publishProject,
  revertProject,
  updateProjectRequirements,
  type QaForSite,
} from '../src/project/siteSession.js';
import type { SiteGenerator, RouteInfo } from '../src/adapters/anthropic/siteGenerator.js';

/* ----------------------------- mock LLM / classificatore ----------------------------- */

const mockLlm = (text: string) => ({ name: 'mock', async complete(): Promise<Result<{ text: string }>> { return ok({ text }); } });

const mockClassifier = {
  async classify(statement: string) {
    if (/^link/i.test(statement)) return ok({ kind: 'navigation', fromRoute: '/', linkText: 'X', toRoutePattern: '/x' } as const);
    if (/form/i.test(statement)) {
      // conferma volutamente GENERICA: la garanzia deterministica del pianificatore
      // deve sovrascriverla col testo esatto citato nella frase.
      return ok({ kind: 'form-submission', route: '/', fields: [{ label: 'Nome', value: 'x' }, { label: 'Email', value: 'y' }], expect: 'confirmation-visible', confirmationText: 'Inviato con successo' } as const);
    }
    const text = statement.match(/"([^"]+)"/)?.[1] ?? statement;
    return ok({ kind: 'content-present', route: '/', text } as const);
  },
};

/* ----------------------------- mock generatore di sito ----------------------------- */

function buildPages(spec: ProjectSpec, routes: readonly RouteInfo[], opts: { drop?: string; secret?: boolean } = {}): SitePage[] {
  const nav = routes.map((r) => `<a href="${r.route}">${r.label}</a>`).join('');
  return routes.map((r) => {
    const contents: string[] = [];
    let form = '';
    for (const c of spec.criteria) {
      const k = c.check;
      if (!k) continue;
      if (k.kind === 'content-present' && k.route === r.route && k.text !== opts.drop) contents.push(`<h2>${k.text}</h2>`);
      else if (k.kind === 'form-submission' && k.route === r.route) form = `<form><input id="nome"><label for="nome">Nome</label><button type="submit">Invia</button><div>${k.confirmationText}</div></form>`;
    }
    const secret = opts.secret && r.route === '/' ? '<!-- AKIA1234567890ABCDEF -->' : '';
    return {
      route: r.route,
      html: `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><nav>${nav}</nav>${contents.join('')}${form}${secret}</body></html>`,
    };
  });
}

function mockGenerator(): SiteGenerator {
  return {
    async generate(spec, routes) { return ok(buildPages(spec, routes)); },
    async fix(spec, routes) { return ok(buildPages(spec, routes)); },
    async edit(spec, routes, current, instruction) {
      if (/nonrendere/i.test(instruction)) return ok([...current]); // simula: non applica la modifica
      if (/rompi/i.test(instruction)) {
        const firstContent = spec.criteria.find((c) => c.check?.kind === 'content-present');
        const drop = firstContent && firstContent.check?.kind === 'content-present' ? firstContent.check.text : undefined;
        return ok(buildPages(spec, routes, { drop }));
      }
      if (/segreto/i.test(instruction)) return ok(buildPages(spec, routes, { secret: true }));
      return ok(buildPages(spec, routes));
    },
  };
}

/* ----------------------------- mock QA (verifica le pagine contro lo spec) ----------------------------- */

const mockQa: QaForSite = async (pages, spec) => {
  const byRoute = new Map(pages.map((p) => [p.route, p.html.toLowerCase()]));
  const level1 = [...byRoute.keys()].map((route) => ({ criterionId: 'L1:' + route, kind: 'route-loads' as const, passed: true }));
  const level2 = spec.criteria
    .filter((c) => c.check)
    .map((c) => {
      const k = c.check!;
      const html = (r: string) => byRoute.get(r) ?? '';
      let passed = false;
      if (k.kind === 'content-present') passed = html(k.route).includes(k.text.toLowerCase());
      else if (k.kind === 'form-submission') passed = html(k.route).includes(k.confirmationText.toLowerCase());
      else if (k.kind === 'responsive') passed = true;
      else if (k.kind === 'route-loads') passed = byRoute.has(k.route);
      else if (k.kind === 'navigation') passed = html(k.fromRoute).includes('href="' + k.toRoutePattern.replace(/\\/g, '') + '"');
      return { criterionId: c.id, kind: k.kind, passed, ...(passed ? {} : { detail: 'mock-fail' }) };
    });
  const report: QaReport = { level1, level2, flagged: [], buildSucceeded: level1.every((c) => c.passed) && level2.every((c) => c.passed) };
  return ok(report);
};

/* =========================================== TEST =========================================== */

test('scanner: pagina pulita non blocca', () => {
  const r = makeBasicSecurityScanner().scan('<html><body><h1>Ciao</h1><script>document.title="x"</script></body></html>');
  assert.equal(r.blocked, false);
  assert.equal(r.findings.length, 0);
});

test('scanner: segreto e script esterno bloccano', () => {
  const r = makeBasicSecurityScanner().scan('<script src="https://x/y.js"></script>AKIA1234567890ABCDEF <script>eval("x")</script>');
  assert.equal(r.blocked, true);
  assert.ok(r.findings.some((f) => f.code === 'AWS_KEY'));
  assert.ok(r.findings.some((f) => f.code === 'EXT_SCRIPT'));
});

test('pianificatore: route riscritte, un form per pagina, nav automatica, nav-da-classificatore scartata', async () => {
  const planJson = JSON.stringify({
    title: 'Sito X',
    category: 'business-landing',
    pages: [
      { route: '/', label: 'Home', statements: ['Titolo "Benvenuti"', 'link vai ai contatti'] },
      { route: '/contatti', label: 'Contatti', statements: ['Form con nome che mostra "Grazie A" dopo invio', 'Form con email che mostra "Grazie B" dopo invio'] },
    ],
  });
  const r = await planSite({ id: 'x', ownerId: 'o', description: 'd', llm: mockLlm(planJson), classifier: mockClassifier });
  assert.ok(r.ok, 'plan ok');
  const checks = r.value.spec.criteria.map((c) => c.check!).filter(Boolean);
  // un solo form, sulla pagina /contatti
  const forms = checks.filter((k) => k.kind === 'form-submission');
  assert.equal(forms.length, 1);
  assert.equal(forms[0]!.kind === 'form-submission' && forms[0]!.route, '/contatti');
  // navigazione: solo quella automatica verso /contatti (quella del classificatore e scartata)
  const navs = checks.filter((k) => k.kind === 'navigation');
  assert.equal(navs.length, 1);
  assert.equal(navs[0]!.kind === 'navigation' && navs[0]!.fromRoute, '/');
  // home garantita
  assert.ok(r.value.routes.some((rt) => rt.route === '/'));
});

test('parser quote: doppie/curve/singole, ignora apostrofi', () => {
  assert.deepEqual(extractQuoted('slogan "La vera pizza" e titolo \u201cBenvenuti\u201d'), ['La vera pizza', 'Benvenuti']);
  assert.deepEqual(extractQuoted("conferma 'Grazie, a presto'"), ['Grazie, a presto']);
  // l'apostrofo NON apre una virgoletta
  assert.deepEqual(extractQuoted("il sito dell'azienda mostra 'Da Ciro'"), ['Da Ciro']);
});

test('parser conferma: sceglie la stringa vicino alla parola-spia', () => {
  assert.equal(pickConfirmation('form con nome ed email che mostra "Prenotazione ricevuta"'), 'Prenotazione ricevuta');
  // due quote: prende quella dopo la spia "mostra", non l'ultima
  assert.equal(pickConfirmation('titolo "Prenota ora", il form mostra "Fatto!" dopo invio'), 'Fatto!');
  assert.equal(pickConfirmation('form senza messaggio'), undefined);
});

test('parser elenchi: esplode "menu (a, b, c)", salta i campi del form', () => {
  const pages = [{ route: '/', label: 'Home' }, { route: '/menu', label: 'Menu' }, { route: '/contatti', label: 'Contatti' }];
  const got = extractLabeledLists('home; pagina menu (Margherita, Marinara, Diavola); contatti con form (nome, email, messaggio)', pages);
  const menu = got.filter((g) => g.route === '/menu').map((g) => g.text);
  assert.deepEqual(menu.sort(), ['Diavola', 'Margherita', 'Marinara']);
  // i campi del form NON diventano contenuti
  assert.equal(got.some((g) => /nome|email|messaggio/i.test(g.text)), false);
});

test('parser elenchi: lista dopo i due punti', () => {
  const pages = [{ route: '/', label: 'Home' }, { route: '/servizi', label: 'Servizi' }];
  const got = extractLabeledLists('servizi: taglio, piega, colore', pages);
  assert.deepEqual(got.filter((g) => g.route === '/servizi').map((g) => g.text).sort(), ['colore', 'piega', 'taglio']);
});

test('fedelta end-to-end: pianificatore pigro, ma voci/conferma/slogan vengono recuperati', async () => {
  const description = "Pizzeria 'Da Ciro': home con slogan 'La vera pizza napoletana', pagina menu (Margherita, Marinara, Diavola), pagina contatti con form (nome, email, messaggio) che conferma 'Grazie, a presto'";
  // il pianificatore "pigro" perde Marinara/Diavola e mette una conferma sbagliata via classificatore
  const lazyPlan = JSON.stringify({
    title: 'Da Ciro',
    category: 'business-landing',
    pages: [
      { route: '/', label: 'Home', statements: ['Mostra "La vera pizza napoletana"'] },
      { route: '/menu', label: 'Menu', statements: ['Mostra "Margherita"'] },
      { route: '/contatti', label: 'Contatti', statements: ['Form con nome, email, messaggio che conferma "Grazie, a presto"'] },
    ],
  });
  const r = await planSite({ id: 'daciro', ownerId: 'o', description, llm: mockLlm(lazyPlan), classifier: mockClassifier });
  assert.ok(r.ok, 'plan ok');
  const C = r.value.spec.criteria;
  const contentOn = (route: string) => C.filter((c) => c.check?.kind === 'content-present' && c.check.route === route).map((c) => (c.check as { text: string }).text);

  // tutte e tre le pizze recuperate su /menu
  const menu = contentOn('/menu');
  for (const pizza of ['Margherita', 'Marinara', 'Diavola']) assert.ok(menu.includes(pizza), 'manca ' + pizza);
  // slogan verbatim sulla home
  assert.ok(contentOn('/').includes('La vera pizza napoletana'), 'slogan perso');
  // conferma del form ESATTA (non quella generica del classificatore)
  const form = C.find((c) => c.check?.kind === 'form-submission');
  assert.ok(form && form.check?.kind === 'form-submission' && form.check.confirmationText === 'Grazie, a presto', 'conferma non esatta');
  // la conferma NON e finita come content-present (comparirebbe solo dopo invio)
  assert.equal(C.some((c) => c.check?.kind === 'content-present' && (c.check as { text: string }).text === 'Grazie, a presto'), false);
});

test('store: roundtrip + migrazione v1(html) -> v2(pages)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-store-'));
  const store = makeFileSiteStore(dir);

  // file v1 single-page scritto a mano
  const v1 = {
    schemaVersion: 1,
    state: { id: 'old', spec: { id: 'old', ownerId: 'o', category: 'portfolio', title: 'T', description: 'd', criteria: [] }, statements: ['s'], html: '<html><body>vecchio</body></html>', status: 'approved', version: 3, updatedAt: '2026-01-01T00:00:00.000Z' },
    history: [],
  };
  await writeFile(join(dir, 'old.json'), JSON.stringify(v1), 'utf8');

  const loaded = await store.load('old');
  assert.ok(loaded.ok && loaded.value, 'migrato');
  assert.equal(loaded.value!.schemaVersion, 2);
  assert.equal(loaded.value!.state.pages.length, 1);
  assert.equal(loaded.value!.state.pages[0]!.route, '/');
  assert.match(loaded.value!.state.pages[0]!.html, /vecchio/);
  assert.equal(loaded.value!.state.status, 'approved');
});

test('scanSite: blocca se una pagina contiene un segreto', () => {
  const pages: SitePage[] = [
    { route: '/', html: '<html><body>ok</body></html>' },
    { route: '/x', html: '<html><body>AKIA1234567890ABCDEF</body></html>' },
  ];
  const r = scanSite(pages, makeBasicSecurityScanner());
  assert.equal(r.blocked, true);
});

test('ciclo di vita multi-pagina: crea -> modifica(accetta) -> modifica(rifiuta) -> approva -> pubblica(bloccata) -> ripristina -> approva -> pubblica', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-sess-'));
  const store = makeFileSiteStore(dir);
  const generator = mockGenerator();
  const scanner = makeBasicSecurityScanner();

  const planJson = JSON.stringify({
    title: 'Studio',
    category: 'business-landing',
    pages: [
      { route: '/', label: 'Home', statements: ['Titolo "Studio Verde"'] },
      { route: '/contatti', label: 'Contatti', statements: ['Form con nome che mostra "Grazie" dopo invio'] },
    ],
  });
  const llm = mockLlm(planJson);

  // CREATE
  const created = await createProject({ store, id: 'site1', ownerId: 'o', description: 'd', llm, classifier: mockClassifier, generator, runQa: mockQa });
  assert.ok(created.ok, 'create ok');
  assert.equal(created.value.report.buildSucceeded, true);
  assert.equal(created.value.state.version, 1);
  assert.equal(created.value.state.pages.length, 2);

  // EDIT accettata (benigna)
  const e1 = await editProject({ store, id: 'site1', instruction: 'ingrandisci i titoli', llm: mockLlm(JSON.stringify({ operations: [] })), generator, runQa: mockQa });
  assert.ok(e1.ok && e1.value.accepted, 'edit benigna accettata');
  assert.equal(e1.value.state.version, 2);

  // EDIT rifiutata (rompe un contenuto richiesto)
  const e2 = await editProject({ store, id: 'site1', instruction: 'rompi il titolo', llm: mockLlm(JSON.stringify({ operations: [] })), generator, runQa: mockQa });
  assert.ok(e2.ok && !e2.value.accepted, 'edit che rompe e rifiutata');
  assert.ok(e2.value.conflicts.length > 0);
  const afterReject = await getProject(store, 'site1');
  assert.equal(afterReject.ok && afterReject.value!.version, 2, 'versione invariata dopo rifiuto');

  // EDIT che inietta un segreto -> accettata dalla QA (contratto ok) ma...
  const e3 = await editProject({ store, id: 'site1', instruction: 'inietta segreto', llm: mockLlm(JSON.stringify({ operations: [] })), generator, runQa: mockQa });
  assert.ok(e3.ok && e3.value.accepted, 'edit con segreto passa il gate di regressione');

  // APPROVE
  const a1 = await approveProject(store, 'site1');
  assert.ok(a1.ok && a1.value.status === 'approved');

  // PUBLISH bloccata dal gate di sicurezza (segreto)
  const p1 = await publishProject({ store, id: 'site1', scanner });
  assert.ok(p1.ok && !p1.value.published, 'pubblicazione bloccata dal segreto');
  assert.equal(p1.value.report.blocked, true);

  // REVERT: torna alla versione prima del segreto
  const rev = await revertProject(store, 'site1');
  assert.ok(rev.ok, 'revert ok');

  // dopo revert lo stato torna preview: riapprova e pubblica
  const a2 = await approveProject(store, 'site1');
  assert.ok(a2.ok && a2.value.status === 'approved');
  const p2 = await publishProject({ store, id: 'site1', scanner });
  assert.ok(p2.ok && p2.value.published, 'pubblicazione ok dopo revert');
  assert.equal(p2.value.state.status, 'published');
});

test('updateProjectRequirements: ripianifica, sostituisce le pagine e versiona', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-upd-'));
  const store = makeFileSiteStore(dir);
  const generator = mockGenerator();

  const planA = JSON.stringify({ title: 'Studio', category: 'business-landing', pages: [
    { route: '/', label: 'Home', statements: ['Titolo "Studio Verde"'] },
    { route: '/contatti', label: 'Contatti', statements: ['Form con nome che mostra "Grazie" dopo invio'] },
  ] });
  const created = await createProject({ store, id: 's', ownerId: 'o', description: 'd', llm: mockLlm(planA), classifier: mockClassifier, generator, runQa: mockQa });
  assert.ok(created.ok && created.value.state.routes.length === 2);

  const planB = JSON.stringify({ title: 'Studio', category: 'business-landing', pages: [
    { route: '/', label: 'Home', statements: ['Titolo "Studio Verde"'] },
    { route: '/servizi', label: 'Servizi', statements: ['Mostra "Consulenza"'] },
  ] });
  const upd = await updateProjectRequirements({ store, id: 's', newDescription: 'servizi: consulenza, audit', llm: mockLlm(planB), classifier: mockClassifier, generator, runQa: mockQa });
  assert.ok(upd.ok, 'update ok');
  assert.equal(upd.value.report.buildSucceeded, true);

  const after = await getProject(store, 's');
  assert.ok(after.ok && after.value);
  assert.equal(after.value!.version, 2, 'versione incrementata');
  assert.deepEqual(after.value!.routes.map((r) => r.route).sort(), ['/', '/servizi'], 'route sostituite');
  assert.equal(after.value!.pages.some((p) => p.route === '/contatti'), false, '/contatti rimossa');
  assert.equal(after.value!.status, 'preview');
});

test('createProject: rifiuta id gia esistente', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-dup-'));
  const store = makeFileSiteStore(dir);
  const generator = mockGenerator();
  const planJson = JSON.stringify({ title: 'A', category: 'portfolio', pages: [{ route: '/', label: 'Home', statements: ['Titolo "A"'] }] });
  const llm = mockLlm(planJson);
  const first = await createProject({ store, id: 'dup', ownerId: 'o', description: 'd', llm, classifier: mockClassifier, generator, runQa: mockQa });
  assert.ok(first.ok);
  const second = await createProject({ store, id: 'dup', ownerId: 'o', description: 'd', llm, classifier: mockClassifier, generator, runQa: mockQa });
  assert.ok(!second.ok && second.error.code === 'PROJECT_EXISTS');
});

/* ----------------------------- modifica che aggiorna il contratto ----------------------------- */

const baseSpec = {
  id: 's', ownerId: 'o', category: 'business-landing' as const, title: 'T', description: 'd',
  criteria: [
    { id: 'c1', statement: 'Mostra "Studio Verde"', confirmed: true, check: { kind: 'content-present' as const, route: '/', text: 'Studio Verde' } },
    { id: 'c2', statement: 'Mostra "Margherita"', confirmed: true, check: { kind: 'content-present' as const, route: '/menu', text: 'Margherita' } },
  ],
};
const baseRoutes: RouteInfo[] = [{ route: '/', label: 'Home' }, { route: '/menu', label: 'Menu' }];
const opsLlm = (operations: unknown[]) => mockLlm(JSON.stringify({ operations }));
const contentTexts = (criteria: readonly { check?: { kind: string; route?: string; text?: string } }[], route: string) =>
  criteria.filter((c) => c.check?.kind === 'content-present' && c.check.route === route).map((c) => c.check!.text!);

test('planEdit add: aggiunge un criterio sulla pagina indicata', async () => {
  const r = await planEdit({ instruction: 'aggiungi al menu la pizza Capricciosa', spec: baseSpec, routes: baseRoutes, llm: opsLlm([{ op: 'add', kind: 'content-present', route: '/menu', text: 'Capricciosa' }]) });
  assert.ok(r.ok);
  assert.ok(contentTexts(r.value.criteria, '/menu').includes('Capricciosa'));
  assert.ok(contentTexts(r.value.criteria, '/menu').includes('Margherita'), 'gli altri restano');
});

test('planEdit change: sostituisce un criterio esistente per numero', async () => {
  const r = await planEdit({ instruction: 'cambia il titolo', spec: baseSpec, routes: baseRoutes, llm: opsLlm([{ op: 'change', target: 1, kind: 'content-present', route: '/', text: 'Studio Blu' }]) });
  assert.ok(r.ok);
  assert.ok(contentTexts(r.value.criteria, '/').includes('Studio Blu'));
  assert.equal(contentTexts(r.value.criteria, '/').includes('Studio Verde'), false, 'il vecchio testo sparisce');
});

test('planEdit remove: toglie un criterio per numero', async () => {
  const r = await planEdit({ instruction: 'togli la margherita', spec: baseSpec, routes: baseRoutes, llm: opsLlm([{ op: 'remove', target: 2 }]) });
  assert.ok(r.ok);
  assert.equal(contentTexts(r.value.criteria, '/menu').includes('Margherita'), false);
});

test('planEdit rete di sicurezza: testo tra virgolette recuperato anche se l\'LLM non produce operazioni', async () => {
  const r = await planEdit({ instruction: 'aggiungi al menu la voce "Quattro Formaggi"', spec: baseSpec, routes: baseRoutes, llm: opsLlm([]) });
  assert.ok(r.ok);
  assert.ok(contentTexts(r.value.criteria, '/menu').includes('Quattro Formaggi'), 'recuperata su /menu');
});

test('planEdit estetica: nessuna operazione, contratto invariato', async () => {
  const r = await planEdit({ instruction: 'ingrandisci i titoli e usa toni verdi', spec: baseSpec, routes: baseRoutes, llm: opsLlm([]) });
  assert.ok(r.ok);
  assert.equal(r.value.criteria.length, baseSpec.criteria.length);
  assert.deepEqual(contentTexts(r.value.criteria, '/menu'), ['Margherita']);
});

test('editProject: una modifica accettata FA CRESCERE il contratto e si vede nel riepilogo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-edit-grow-'));
  const store = makeFileSiteStore(dir);
  const generator = mockGenerator();
  const planA = JSON.stringify({ title: 'Studio', category: 'business-landing', pages: [
    { route: '/', label: 'Home', statements: ['Titolo "Studio Verde"'] },
    { route: '/menu', label: 'Menu', statements: ['Mostra "Margherita"'] },
  ] });
  const created = await createProject({ store, id: 'g', ownerId: 'o', description: 'd', llm: mockLlm(planA), classifier: mockClassifier, generator, runQa: mockQa });
  assert.ok(created.ok);

  const e = await editProject({ store, id: 'g', instruction: 'aggiungi al menu la pizza Capricciosa', llm: opsLlm([{ op: 'add', kind: 'content-present', route: '/menu', text: 'Capricciosa' }]), generator, runQa: mockQa });
  assert.ok(e.ok && e.value.accepted, 'modifica accettata');
  assert.ok(e.value.changes.length > 0);

  const after = await getProject(store, 'g');
  assert.ok(after.ok && after.value);
  assert.ok(contentTexts(after.value!.spec.criteria, '/menu').includes('Capricciosa'), 'criterio aggiunto e persistito');
  const sm = summarizeSite(after.value!.spec, after.value!.routes);
  const menu = sm.pages.find((p) => p.route === '/menu')!;
  assert.ok(menu.contents.includes('Capricciosa'), 'il riepilogo riflette la modifica');
});

test('editProject: una modifica che NON ottiene il criterio richiesto viene RIFIUTATA (verifica reale)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-edit-verify-'));
  const store = makeFileSiteStore(dir);
  const generator = mockGenerator();
  const planA = JSON.stringify({ title: 'Studio', category: 'business-landing', pages: [
    { route: '/', label: 'Home', statements: ['Titolo "Studio Verde"'] },
    { route: '/menu', label: 'Menu', statements: ['Mostra "Margherita"'] },
  ] });
  const created = await createProject({ store, id: 'v', ownerId: 'o', description: 'd', llm: mockLlm(planA), classifier: mockClassifier, generator, runQa: mockQa });
  assert.ok(created.ok);

  // l'estrattore chiede di aggiungere Capricciosa, ma il generatore "nonrendere" non la mette
  const e = await editProject({ store, id: 'v', instruction: 'aggiungi Capricciosa al menu nonrendere', llm: opsLlm([{ op: 'add', kind: 'content-present', route: '/menu', text: 'Capricciosa' }]), generator, runQa: mockQa });
  assert.ok(e.ok && !e.value.accepted, 'rifiutata perche il criterio nuovo non e soddisfatto');
  assert.ok(e.value.conflicts.length > 0);

  const after = await getProject(store, 'v');
  assert.ok(after.ok && after.value);
  assert.equal(contentTexts(after.value!.spec.criteria, '/menu').includes('Capricciosa'), false, 'contratto NON modificato');
  assert.equal(after.value!.version, 1, 'versione invariata');
});

/* ----------------------------- hosting ----------------------------- */

import { makeCloudflarePagesHost, sanitizeProjectName, layoutFiles } from '../src/adapters/hosting/cloudflarePages.js';
import type { SiteHostingProvider } from '../src/core/index.js';

test('hosting: nome progetto Cloudflare valido', () => {
  assert.equal(sanitizeProjectName("Pizzeria 'Da Ciro'!"), 'pizzeria-da-ciro');
  assert.equal(sanitizeProjectName('  ---  '), 'sito');
  assert.ok(sanitizeProjectName('x'.repeat(80)).length <= 58);
});

test('hosting: layout a cartelle (/, /menu -> menu/index.html)', () => {
  const files = layoutFiles([{ route: '/', html: 'H' }, { route: '/menu', html: 'M' }]);
  assert.deepEqual(files.map((f) => f.path).sort(), ['index.html', 'menu/index.html']);
});

test('hosting: senza credenziali la deploy fallisce con messaggio chiaro', async () => {
  const host = makeCloudflarePagesHost({}); // nessun token/account
  const r = await host.deploy({ siteId: 's', pages: [{ route: '/', html: 'x' }] });
  assert.ok(!r.ok && r.error.code === 'HOSTING_NOT_CONFIGURED');
});

test('hosting: runner mockato -> deploy ok, URL stabile', async () => {
  const host = makeCloudflarePagesHost({ apiToken: 't', accountId: 'a', runner: async () => ok('Deployment complete https://abc123.pizzeria.pages.dev') });
  const r = await host.deploy({ siteId: 'pizzeria', pages: [{ route: '/', html: 'x' }] });
  assert.ok(r.ok && r.value.url === 'https://pizzeria.pages.dev');
});

test('publishProject: con host pubblica e salva URL; con host che fallisce resta approvato', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brik-host-'));
  const store = makeFileSiteStore(dir);
  const generator = mockGenerator();
  const planA = JSON.stringify({ title: 'Studio', category: 'business-landing', pages: [{ route: '/', label: 'Home', statements: ['Titolo "Studio"'] }] });
  const created = await createProject({ store, id: 'h', ownerId: 'o', description: 'd', llm: mockLlm(planA), classifier: mockClassifier, generator, runQa: mockQa });
  assert.ok(created.ok);
  await approveProject(store, 'h');

  // host che FALLISCE -> publish ritorna errore, lo stato resta approved
  const failHost: SiteHostingProvider = { async deploy() { return err(appError('HOSTING_DEPLOY_FAILED', 'boom')); } };
  const pf = await publishProject({ store, id: 'h', scanner: makeBasicSecurityScanner(), host: failHost });
  assert.ok(!pf.ok, 'publish fallisce se il deploy fallisce');
  const stillApproved = await getProject(store, 'h');
  assert.equal(stillApproved.ok && stillApproved.value!.status, 'approved', 'non risulta pubblicato');

  // host che funziona -> published con URL
  const okHost: SiteHostingProvider = { async deploy() { return ok({ url: 'https://h.pages.dev' }); } };
  const pok = await publishProject({ store, id: 'h', scanner: makeBasicSecurityScanner(), host: okHost });
  assert.ok(pok.ok && pok.value.published);
  assert.equal(pok.value.state.url, 'https://h.pages.dev');
  assert.equal(pok.value.state.status, 'published');
});
