/**
 * Sessione del progetto-sito (Fase 3 / tappa 2): ciclo di vita completo sul
 * modello multi-pagina, con persistenza, versioning e undo.
 *
 *  - createProject:           descrizione -> pianifica -> genera+QA -> verde -> persiste
 *  - editProject:             modifica in linguaggio naturale + gate di regressione su TUTTE le pagine
 *  - updateProjectRequirements: nuova descrizione -> ripianifica -> rigenera (la struttura puo cambiare)
 *  - approveProject / publishProject (gate sicurezza su ogni pagina) / revertProject
 */
import {
  type ProjectSpec,
  type SitePage,
  type QaReport,
  type IntakeClassifier,
  type LLMProvider,
  type Result,
  ok,
  err,
  appError,
} from '@core';
import { planSite } from '../intake/sitePlanner.js';
import { planEdit } from '../intake/editPlanner.js';
import { repairSite } from '../orchestrator/repairSite.js';
import type { SiteGenerator } from '../adapters/anthropic/siteGenerator.js';
import type { EditConflict } from '../orchestrator/edit.js';
import type { SecurityScanner } from '../security/scanner.js';
import { scanSite, summarizeSite, type SiteScanReport, type SiteSummary } from './site.js';
import type { SiteStore } from './siteStore.js';
import type { SiteFile, SiteState, SiteHistoryEntry } from './siteTypes.js';

const HISTORY_MAX = 10;
const now = (): string => new Date().toISOString();

/** QA per un insieme di pagine e uno spec (il chiamante gestisce server/browser). */
export type QaForSite = (pages: readonly SitePage[], spec: ProjectSpec) => Promise<Result<QaReport>>;

const notFound = (id: string) => appError('PROJECT_NOT_FOUND', 'Progetto non trovato: ' + id, { retryable: false });

function pushHistory(history: readonly SiteHistoryEntry[], s: SiteState, note: string): SiteHistoryEntry[] {
  const e: SiteHistoryEntry = { version: s.version, criteria: s.spec.criteria, statements: s.statements, routes: s.routes, pages: s.pages, note, at: now() };
  return [...history, e].slice(-HISTORY_MAX);
}

export async function createProject(args: {
  readonly store: SiteStore;
  readonly id: string;
  readonly ownerId: string;
  readonly description: string;
  readonly llm: LLMProvider;
  readonly classifier: IntakeClassifier;
  readonly generator: SiteGenerator;
  readonly runQa: QaForSite;
  readonly maxRepairs?: number;
}): Promise<Result<{ state: SiteState; summary: SiteSummary; report: QaReport }>> {
  const existing = await args.store.load(args.id);
  if (!existing.ok) return err(existing.error);
  if (existing.value) return err(appError('PROJECT_EXISTS', 'Progetto gia esistente: ' + args.id, { retryable: false }));

  const plan = await planSite({ id: args.id, ownerId: args.ownerId, description: args.description, llm: args.llm, classifier: args.classifier });
  if (!plan.ok) return err(plan.error);
  const { spec, routes } = plan.value;

  const built = await repairSite({ spec, routes, generator: args.generator, runQa: (p) => args.runQa(p, spec), maxRepairs: args.maxRepairs ?? 3 });
  if (!built.ok) return err(built.error);
  if (!built.value.report.buildSucceeded) return err(appError('CREATE_NOT_GREEN', 'Non sono riuscito a portare il sito al verde.', { retryable: true }));

  const statements = spec.criteria.map((c) => c.statement);
  const state: SiteState = {
    id: args.id,
    spec,
    statements,
    routes,
    pages: built.value.pages,
    status: 'preview',
    version: 1,
    updatedAt: now(),
  };
  const saved = await args.store.save({ schemaVersion: 2, state, history: [] });
  if (!saved.ok) return err(saved.error);
  return ok({ state, summary: summarizeSite(spec, routes), report: built.value.report });
}

export async function getProject(store: SiteStore, id: string): Promise<Result<SiteState | null>> {
  const f = await store.load(id);
  if (!f.ok) return err(f.error);
  return ok(f.value ? f.value.state : null);
}

export async function approveProject(store: SiteStore, id: string): Promise<Result<SiteState>> {
  const f = await store.load(id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(notFound(id));
  if (f.value.state.status === 'approved') return ok(f.value.state);
  const state: SiteState = { ...f.value.state, status: 'approved', updatedAt: now() };
  const saved = await store.save({ ...f.value, state });
  if (!saved.ok) return err(saved.error);
  return ok(state);
}

export async function editProject(args: {
  readonly store: SiteStore;
  readonly id: string;
  readonly instruction: string;
  readonly llm: LLMProvider;
  readonly generator: SiteGenerator;
  readonly runQa: QaForSite;
}): Promise<Result<{ accepted: boolean; state: SiteState; conflicts: readonly EditConflict[]; changes: readonly string[] }>> {
  const f = await args.store.load(args.id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(notFound(args.id));
  const cur = f.value.state;

  // 1) Dall'istruzione ricava il contratto AGGIORNATO (aggiungi/cambia/rimuovi).
  const plan = await planEdit({ instruction: args.instruction, spec: cur.spec, routes: cur.routes, llm: args.llm });
  if (!plan.ok) return err(plan.error);
  const newSpec: ProjectSpec = { ...cur.spec, criteria: [...plan.value.criteria] };

  // 2) Rigenera applicando la modifica, poi VERIFICA contro il contratto nuovo.
  const edited = await args.generator.edit(newSpec, cur.routes, cur.pages, args.instruction);
  if (!edited.ok) return err(edited.error);

  const qa = await args.runQa(edited.value, newSpec);
  if (!qa.ok) return err(qa.error);
  const report = qa.value;

  if (!report.buildSucceeded) {
    const conflicts: EditConflict[] = [...report.level1, ...report.level2]
      .filter((r) => !r.passed)
      .map((r) => ({ criterionId: r.criterionId, kind: r.kind, detail: r.detail ?? 'check fallito' }));
    return ok({ accepted: false, state: cur, conflicts, changes: plan.value.changes });
  }

  const history = pushHistory(f.value.history, cur, 'modifica: ' + args.instruction);
  const state: SiteState = {
    ...cur,
    spec: newSpec,
    statements: newSpec.criteria.map((c) => c.statement),
    pages: edited.value,
    status: 'preview',
    version: cur.version + 1,
    updatedAt: now(),
  };
  const saved = await args.store.save({ ...f.value, state, history });
  if (!saved.ok) return err(saved.error);
  return ok({ accepted: true, state, conflicts: [], changes: plan.value.changes });
}

export async function updateProjectRequirements(args: {
  readonly store: SiteStore;
  readonly id: string;
  readonly newDescription: string;
  readonly llm: LLMProvider;
  readonly classifier: IntakeClassifier;
  readonly generator: SiteGenerator;
  readonly runQa: QaForSite;
  readonly maxRepairs?: number;
}): Promise<Result<{ state: SiteState; summary: SiteSummary; report: QaReport }>> {
  const f = await args.store.load(args.id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(notFound(args.id));
  const cur = f.value.state;

  const plan = await planSite({ id: cur.id, ownerId: cur.spec.ownerId, description: args.newDescription, llm: args.llm, classifier: args.classifier });
  if (!plan.ok) return err(plan.error);
  const { spec, routes } = plan.value;

  const built = await repairSite({ spec, routes, generator: args.generator, runQa: (p) => args.runQa(p, spec), maxRepairs: args.maxRepairs ?? 3 });
  if (!built.ok) return err(built.error);
  if (!built.value.report.buildSucceeded) return err(appError('UPDATE_NOT_GREEN', 'Non sono riuscito ad adeguare il sito ai nuovi requisiti.', { retryable: true }));

  const history = pushHistory(f.value.history, cur, 'aggiornamento requisiti');
  const state: SiteState = {
    ...cur,
    spec,
    routes,
    statements: spec.criteria.map((c) => c.statement),
    pages: built.value.pages,
    status: 'preview',
    version: cur.version + 1,
    updatedAt: now(),
  };
  const saved = await args.store.save({ ...f.value, state, history });
  if (!saved.ok) return err(saved.error);
  return ok({ state, summary: summarizeSite(spec, routes), report: built.value.report });
}

export async function revertProject(store: SiteStore, id: string): Promise<Result<SiteState>> {
  const f = await store.load(id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(notFound(id));
  const history = [...f.value.history];
  const last = history.pop();
  if (!last) return err(appError('NO_HISTORY', 'Nessuna versione precedente da ripristinare.', { retryable: false }));
  const cur = f.value.state;
  const state: SiteState = {
    ...cur,
    spec: { ...cur.spec, criteria: [...last.criteria] },
    statements: last.statements,
    routes: last.routes,
    pages: last.pages,
    status: 'preview',
    version: cur.version + 1,
    updatedAt: now(),
  };
  const saved = await store.save({ ...f.value, state, history });
  if (!saved.ok) return err(saved.error);
  return ok(state);
}

export async function publishProject(args: {
  readonly store: SiteStore;
  readonly id: string;
  readonly scanner: SecurityScanner;
}): Promise<Result<{ published: boolean; state: SiteState; report: SiteScanReport }>> {
  const f = await args.store.load(args.id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(notFound(args.id));
  const cur = f.value.state;
  if (cur.status !== 'approved') {
    return err(appError('NOT_APPROVED', 'Approva il progetto prima di pubblicare (stato attuale: ' + cur.status + ').', { retryable: false }));
  }
  const report = scanSite(cur.pages, args.scanner);
  if (report.blocked) return ok({ published: false, state: cur, report });

  const state: SiteState = { ...cur, status: 'published', updatedAt: now(), publishedAt: now() };
  const saved = await args.store.save({ ...f.value, state });
  if (!saved.ok) return err(saved.error);
  return ok({ published: true, state, report });
}
