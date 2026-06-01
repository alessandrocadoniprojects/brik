/**
 * API di sessione del progetto (Fase 2): unico punto da cui l'app guida il
 * ciclo di vita, con persistenza, versioning e undo.
 *
 *  - createProject:          intake -> genera -> verde -> persiste (status preview)
 *  - getProject:             stato corrente
 *  - approveProject:         status -> approved
 *  - editProject:            modifica libera + gate di regressione (criteri PERSISTITI)
 *  - updateProjectRequirements: cambia le frasi; riclassifica SOLO quelle cambiate
 *                            (le invariate riusano i criteri verbatim: niente drift)
 *  - revertProject:          torna alla versione precedente (history)
 */
import {
  type ProjectSpec,
  type AcceptanceCriterion,
  type IntakeClassifier,
  type CodeGenerator,
  type LLMProvider,
  type QaReport,
  type Result,
  ok,
  err,
  appError,
} from '@core';
import { buildCriteria } from '../intake/index.js';
import { repairLoop } from '../orchestrator/repair.js';
import { applyChange, type EditConflict } from '../orchestrator/edit.js';
import { summarizeSpec, type PreviewSummary } from '../orchestrator/preview.js';
import type { SecurityScanner, ScanReport } from '../security/scanner.js';
import type { SessionStore } from './store.js';
import type { ProjectFile, ProjectState, HistoryEntry } from './types.js';

const HISTORY_MAX = 10;
const now = (): string => new Date().toISOString();

/** QA per un dato HTML e spec: il chiamante possiede server/browser. */
export type QaFor = (html: string, spec: ProjectSpec) => Promise<Result<QaReport>>;

export interface ProjectMeta {
  readonly ownerId: string;
  readonly category: ProjectSpec['category'];
  readonly title: string;
  readonly description: string;
  readonly knownRoutes: readonly string[];
}

const notFound = (id: string) =>
  appError('PROJECT_NOT_FOUND', 'Progetto non trovato: ' + id, { retryable: false });

function pushHistory(history: readonly HistoryEntry[], state: ProjectState, note: string): HistoryEntry[] {
  const entry: HistoryEntry = {
    version: state.version,
    statements: state.statements,
    criteria: state.spec.criteria,
    html: state.html,
    note,
    at: now(),
  };
  return [...history, entry].slice(-HISTORY_MAX);
}

export async function createProject(args: {
  readonly store: SessionStore;
  readonly id: string;
  readonly statements: readonly string[];
  readonly meta: ProjectMeta;
  readonly classifier: IntakeClassifier;
  readonly codegen: CodeGenerator;
  readonly llm: LLMProvider;
  readonly runQa: QaFor;
  readonly maxRepairs?: number;
}): Promise<Result<{ state: ProjectState; summary: PreviewSummary; report: QaReport }>> {
  const existing = await args.store.load(args.id);
  if (!existing.ok) return err(existing.error);
  if (existing.value) return err(appError('PROJECT_EXISTS', 'Progetto già esistente: ' + args.id, { retryable: false }));

  const crit = await buildCriteria(
    { statements: args.statements, context: { category: args.meta.category, knownRoutes: args.meta.knownRoutes } },
    args.classifier,
  );
  if (!crit.ok) return err(crit.error);

  const spec: ProjectSpec = {
    id: args.id,
    ownerId: args.meta.ownerId,
    category: args.meta.category,
    title: args.meta.title,
    description: args.meta.description,
    criteria: crit.value,
  };

  const gen = await args.codegen.generate(spec);
  if (!gen.ok) return err(gen.error);
  const initialHtml = gen.value.files.find((f) => f.path === 'index.html')?.contents ?? '';

  const outcome = await repairLoop({
    spec,
    llm: args.llm,
    initialHtml,
    runQa: (h) => args.runQa(h, spec),
    maxRepairs: args.maxRepairs ?? 3,
  });
  if (!outcome.ok) return err(outcome.error);
  if (!outcome.value.report.buildSucceeded) {
    return err(appError('CREATE_NOT_GREEN', 'Non sono riuscito a portare la pagina al verde.', { retryable: true }));
  }

  const state: ProjectState = {
    id: args.id,
    spec,
    statements: args.statements,
    html: outcome.value.html,
    status: 'preview',
    version: 1,
    updatedAt: now(),
  };
  const saved = await args.store.save({ schemaVersion: 1, state, history: [] });
  if (!saved.ok) return err(saved.error);

  return ok({ state, summary: summarizeSpec(spec), report: outcome.value.report });
}

export async function getProject(store: SessionStore, id: string): Promise<Result<ProjectState | null>> {
  const f = await store.load(id);
  if (!f.ok) return err(f.error);
  return ok(f.value ? f.value.state : null);
}

export async function approveProject(store: SessionStore, id: string): Promise<Result<ProjectState>> {
  const f = await store.load(id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(notFound(id));
  if (f.value.state.status === 'approved') return ok(f.value.state);
  const state: ProjectState = { ...f.value.state, status: 'approved', updatedAt: now() };
  const saved = await store.save({ ...f.value, state });
  if (!saved.ok) return err(saved.error);
  return ok(state);
}

export async function editProject(args: {
  readonly store: SessionStore;
  readonly id: string;
  readonly instruction: string;
  readonly llm: LLMProvider;
  readonly runQa: QaFor;
}): Promise<Result<{ accepted: boolean; state: ProjectState; conflicts: readonly EditConflict[] }>> {
  const f = await args.store.load(args.id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(notFound(args.id));
  const cur = f.value.state;

  const out = await applyChange({
    spec: cur.spec,
    currentHtml: cur.html,
    instruction: args.instruction,
    llm: args.llm,
    runQa: (h) => args.runQa(h, cur.spec),
  });
  if (!out.ok) return err(out.error);
  if (!out.value.accepted) return ok({ accepted: false, state: cur, conflicts: out.value.conflicts });

  const history = pushHistory(f.value.history, cur, 'modifica: ' + args.instruction);
  const state: ProjectState = { ...cur, html: out.value.html, status: 'preview', version: cur.version + 1, updatedAt: now() };
  const saved = await args.store.save({ ...f.value, state, history });
  if (!saved.ok) return err(saved.error);
  return ok({ accepted: true, state, conflicts: [] });
}

export async function updateProjectRequirements(args: {
  readonly store: SessionStore;
  readonly id: string;
  readonly newStatements: readonly string[];
  readonly classifier: IntakeClassifier;
  readonly llm: LLMProvider;
  readonly runQa: QaFor;
  readonly knownRoutes: readonly string[];
  readonly maxRepairs?: number;
}): Promise<Result<{ state: ProjectState; summary: PreviewSummary; report: QaReport; reclassified: number }>> {
  const f = await args.store.load(args.id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(notFound(args.id));
  const cur = f.value.state;

  // Riusa i criteri delle frasi INVARIATE (verbatim); classifica solo le nuove/cambiate.
  const prevByStatement = new Map(cur.spec.criteria.map((c) => [c.statement, c] as const));
  const slots: (AcceptanceCriterion | null)[] = args.newStatements.map(() => null);
  const toClassify: { idx: number; statement: string }[] = [];
  args.newStatements.forEach((st, i) => {
    const prev = prevByStatement.get(st);
    if (prev) slots[i] = prev;
    else toClassify.push({ idx: i, statement: st });
  });
  for (const { idx, statement } of toClassify) {
    const r = await args.classifier.classify(statement, { category: cur.spec.category, knownRoutes: args.knownRoutes });
    if (!r.ok) return err(r.error);
    slots[idx] = r.value
      ? { id: 'c' + (idx + 1), statement, confirmed: true, check: r.value }
      : { id: 'c' + (idx + 1), statement, confirmed: true };
  }
  // Re-id stabile per posizione.
  const criteria: AcceptanceCriterion[] = args.newStatements.map((st, i) => {
    const c = slots[i];
    if (!c) return { id: 'c' + (i + 1), statement: st, confirmed: true };
    return { ...c, id: 'c' + (i + 1), statement: st };
  });
  const spec: ProjectSpec = { ...cur.spec, criteria };

  const outcome = await repairLoop({
    spec,
    llm: args.llm,
    initialHtml: cur.html,
    runQa: (h) => args.runQa(h, spec),
    maxRepairs: args.maxRepairs ?? 3,
  });
  if (!outcome.ok) return err(outcome.error);
  if (!outcome.value.report.buildSucceeded) {
    return err(appError('UPDATE_NOT_GREEN', 'Non sono riuscito ad adeguare la pagina ai nuovi requisiti.', { retryable: true }));
  }

  const history = pushHistory(f.value.history, cur, 'aggiornamento requisiti');
  const state: ProjectState = {
    ...cur,
    spec,
    statements: args.newStatements,
    html: outcome.value.html,
    status: 'preview',
    version: cur.version + 1,
    updatedAt: now(),
  };
  const saved = await args.store.save({ ...f.value, state, history });
  if (!saved.ok) return err(saved.error);

  return ok({ state, summary: summarizeSpec(spec), report: outcome.value.report, reclassified: toClassify.length });
}

export async function revertProject(store: SessionStore, id: string): Promise<Result<ProjectState>> {
  const f = await store.load(id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(notFound(id));
  const history = [...f.value.history];
  const last = history.pop();
  if (!last) return err(appError('NO_HISTORY', 'Nessuna versione precedente da ripristinare.', { retryable: false }));
  const cur = f.value.state;
  const state: ProjectState = {
    ...cur,
    spec: { ...cur.spec, criteria: [...last.criteria] },
    statements: last.statements,
    html: last.html,
    status: 'preview',
    version: cur.version + 1,
    updatedAt: now(),
  };
  const saved = await store.save({ ...f.value, state, history });
  if (!saved.ok) return err(saved.error);
  return ok(state);
}

/**
 * Pubblicazione: richiede lo stato 'approved' e supera il gate di sicurezza.
 * Se il gate blocca, NON pubblica e restituisce i findings. Il deploy verso un
 * sottodominio è Fase 3: qui si marca 'published' e l'artefatto è la pagina.
 */
export async function publishProject(args: {
  readonly store: SessionStore;
  readonly id: string;
  readonly scanner: SecurityScanner;
}): Promise<Result<{ published: boolean; state: ProjectState; report: ScanReport }>> {
  const f = await args.store.load(args.id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(notFound(args.id));
  const cur = f.value.state;

  if (cur.status !== 'approved') {
    return err(appError('NOT_APPROVED', 'Approva il progetto prima di pubblicare (stato attuale: ' + cur.status + ').', { retryable: false }));
  }

  const report = args.scanner.scan(cur.html);
  if (report.blocked) {
    // gate fallito: non si pubblica, lo stato resta invariato
    return ok({ published: false, state: cur, report });
  }

  const state: ProjectState = { ...cur, status: 'published', updatedAt: now(), publishedAt: now() };
  const saved = await args.store.save({ ...f.value, state });
  if (!saved.ok) return err(saved.error);
  return ok({ published: true, state, report });
}
