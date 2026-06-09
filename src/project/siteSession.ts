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
  type AcceptanceCriterion,
  type SitePage,
  type QaReport,
  type IntakeClassifier,
  type LLMProvider,
  type SiteHostingProvider,
  type Result,
  ok,
  err,
  appError,
} from '@core';
import { planSite, explicitName } from '../intake/sitePlanner.js';
import { planEdit } from '../intake/editPlanner.js';
import { repairSite } from '../orchestrator/repairSite.js';
import { reviewSite } from './directorReview.js';
import { creativeDirectionFromDescription, creativeNotesFor, preferredTheme, detectIndustry } from '../intake/industryEngine.js';
import { isTheme, themeOfPages, DEFAULT_THEME } from '../adapters/anthropic/designSystem.js';
import { scanDesignAntiPatterns, findingsToDirectorNotes, summarizeForReview, formatFindingsForLog, type DesignScanContext } from './designAntiPatternDetector.js';
import { cleanupPages } from './cleanupHtml.js';
import type { SiteGenerator, RouteInfo } from '../adapters/anthropic/siteGenerator.js';
import type { EditConflict } from '../orchestrator/edit.js';
import type { SecurityScanner } from '../security/scanner.js';
import { scanSite, summarizeSite, type SiteScanReport, type SiteSummary } from './site.js';
import type { SiteStore } from './siteStore.js';
import type { SiteFile, SiteState, SiteHistoryEntry, SavedCreativeDirection } from './siteTypes.js';

const HISTORY_MAX = 10;
const now = (): string => new Date().toISOString();

// Osservabilità diagnostica: spenta di default, attiva SOLO con BRIK_DIAG=true|1.
// Racchiude esclusivamente delle console.log; non tocca alcun percorso decisionale.
const diagOn = (): boolean => /^(true|1)$/i.test(process.env.BRIK_DIAG ?? '');

/** QA per un insieme di pagine e uno spec (il chiamante gestisce server/browser). */
export type QaForSite = (pages: readonly SitePage[], spec: ProjectSpec) => Promise<Result<QaReport>>;

const notFound = (id: string) => appError('PROJECT_NOT_FOUND', 'Progetto non trovato: ' + id, { retryable: false });

function pushHistory(history: readonly SiteHistoryEntry[], s: SiteState, note: string): SiteHistoryEntry[] {
  const e: SiteHistoryEntry = { version: s.version, criteria: s.spec.criteria, statements: s.statements, routes: s.routes, pages: s.pages, note, at: now() };
  return [...history, e].slice(-HISTORY_MAX);
}

/**
 * Sitemap minima usata quando il planner va in timeout: home + route interne standard,
 * scelte per settore se rilevabile dalla descrizione (altrimenti generiche). Le interne
 * diventano placeholder e vengono completate in background come per un piano normale.
 */
function fallbackRoutes(description: string): RouteInfo[] {
  let industry: string = 'generic';
  try { industry = detectIndustry(description); } catch { /* fallback generico */ }
  const home: RouteInfo = { route: '/', label: 'Home' };
  const SERVIZI: RouteInfo = { route: '/servizi', label: 'Servizi' };
  const CHI: RouteInfo = { route: '/chi-siamo', label: 'Chi siamo' };
  const CONTATTI: RouteInfo = { route: '/contatti', label: 'Contatti' };
  const byIndustry: Record<string, RouteInfo[]> = {
    creative_agency: [SERVIZI, { route: '/portfolio', label: 'Portfolio' }, CHI, CONTATTI],
    consulting_advisory: [SERVIZI, { route: '/metodo', label: 'Metodo' }, CHI, CONTATTI],
    restaurant: [{ route: '/menu', label: 'Menu' }, CHI, CONTATTI],
    dentist: [SERVIZI, CHI, CONTATTI],
    law_firm: [SERVIZI, CHI, CONTATTI],
  };
  const interiors = byIndustry[industry] ?? [SERVIZI, CHI, CONTATTI];
  return [home, ...interiors];
}

export async function createHome(args: {
  readonly store: SiteStore;
  readonly id: string;
  readonly ownerId: string;
  readonly description: string;
  readonly llm: LLMProvider;
  readonly classifier: IntakeClassifier;
  readonly generator: SiteGenerator;
  readonly runQa: QaForSite;
  readonly maxRepairs?: number;
  /** Gate "direttore creativo": giudica la home e rigenera una volta se sotto soglia. Default ON. */
  readonly review?: boolean;
  readonly reviewMinScore?: number;
  /** Materiale reale (allegati / sito importato) per la prima bozza. */
  readonly content?: string;
  /** Stile scelto dall'utente: se valido, sovrascrive la scelta automatica del modello. */
  readonly theme?: string;
  /** modern-saas: 'generated' | 'user' | 'none' — come mostrare il prodotto. */
  readonly saasVisual?: string;
  /** creative-studio: 'light' | 'dark'. */
  readonly variant?: string;
  /** Interno: genera TUTTE le route in un colpo (comportamento legacy, no placeholder). */
  readonly allRoutes?: boolean;
}): Promise<Result<{ state: SiteState; summary: SiteSummary; report: QaReport; completion: CompletionPlan }>> {
  const existing = await args.store.load(args.id);
  if (!existing.ok) return err(existing.error);
  if (existing.value) return err(appError('PROJECT_EXISTS', 'Progetto gia esistente: ' + args.id, { retryable: false }));

  const tPlan = Date.now();
  console.log('    \u23f1 generation_start \u00b7 plan_start');
  const planCapMs = Number(process.env.BRIK_PLAN_CAP_MS) || 6_000;
  const tPlanWait = Date.now();
  const planRace = await Promise.race([
    planSite({ id: args.id, ownerId: args.ownerId, description: args.description, llm: args.llm, classifier: args.classifier, ...(args.content ? { content: args.content } : {}) }).then((r) => ({ kind: 'plan' as const, r })),
    new Promise<{ kind: 'timeout' }>((res) => setTimeout(() => res({ kind: 'timeout' as const }), planCapMs)),
  ]);
  console.log('    \u23f1 planner_wait_time: ' + ((Date.now() - tPlanWait) / 1000).toFixed(1) + 's');
  let spec: ProjectSpec;
  let routes: readonly RouteInfo[];
  if (planRace.kind === 'timeout') {
    // Fallback: sitemap MINIMA (home + route interne standard, sector-aware). NON solo home,
    // cosi il background completa le interne come per un piano normale.
    const title = explicitName(args.description) || args.id;
    spec = { id: args.id, ownerId: args.ownerId, category: 'business-landing', title, description: args.description, criteria: [], ...(args.content ? { content: args.content } : {}) };
    routes = fallbackRoutes(args.description);
    console.log('    \u23f1 plan_timeout_fallback: sitemap minima (' + routes.length + ' route) dopo ' + (planCapMs / 1000).toFixed(0) + 's [' + routes.map((r) => r.route).join(',') + ']');
  } else {
    if (!planRace.r.ok) return err(planRace.r.error);
    spec = planRace.r.value.spec;
    routes = planRace.r.value.routes;
    console.log('    \u23f1 plan_done: ' + ((Date.now() - tPlan) / 1000).toFixed(1) + 's');
  }

  // Livello decisionale (PREVIEW): calcolo la direzione creativa, la loggo, ne ricavo le
  // note per il prompt e il tema effettivo. La SALVO poi nello stato, cosi la finalizzazione
  // premium al publish usera ESATTAMENTE questa direzione, non una ricostruita dal titolo.
  let creativeNotes: string[] = [];
  let effectiveTheme: string | undefined = args.theme; // default: scelta utente (o undefined -> default generatore)
  let savedCreative: SavedCreativeDirection | undefined;
  try {
    const cd = creativeDirectionFromDescription(args.description);
    console.log('    \u{1F3AC} creative_direction: ' + JSON.stringify({
      industry: cd.industry,
      detected: cd.detected,
      theme: cd.recommendedTheme ?? null,
      variant: cd.recommendedVariant ?? null,
      pattern: cd.dominantPattern,
      emotion: cd.primaryEmotion,
      directives: cd.directives.length,
    }));
    creativeNotes = creativeNotesFor(cd);
    const pref = preferredTheme(args.theme, cd, isTheme);
    if (pref.source === 'creative_direction' && pref.theme) {
      effectiveTheme = pref.theme;
      console.log('    \u{1F3AC} tema da creative_direction: ' + effectiveTheme + ' (utente non ha scelto)');
    }
    savedCreative = { direction: cd, notes: creativeNotes, theme: effectiveTheme ?? null };
  } catch (e) { /* il livello decisionale non deve mai disturbare la creazione */ }

  // PREVIEW = UNA sola generazione. Nessuna rigenerazione automatica: la passata premium
  // del direttore e spostata al publish (finalizeProject). Cosi la preview e veloce.
  // Fast Preview: la PRIMA preview genera SOLO la home. Le route interne restano
  // placeholder e vengono completate in background (completePages). Cosi la home e
  // visibile prima, senza attendere tutte le pagine.
  const homeRoute = routes.find((r) => r.route === '/' || r.route === '') ?? routes[0];
  const fast = args.allRoutes !== true;
  const homeKey = homeRoute ? homeRoute.route : undefined;
  const interiorRoutes = fast ? routes.filter((r) => r.route !== homeKey) : [];
  const genRoutes = fast && homeRoute ? [homeRoute] : routes;
  const maxRepairs = args.maxRepairs ?? 3;
  const tGenPreview = Date.now();
  let builtPages: readonly SitePage[];
  let builtReport: QaReport;
  if (fast) {
    // PATH CRITICO PREVIEW: UNA sola generazione, NESSUN ciclo fix, NESSUN CREATE_NOT_GREEN.
    // La home appare appena e renderizzabile. QA/fix girano dopo, in background (refineHome).
    console.log('    \u23f1 home_generation_start');
    const homeMaxTokens = Number(process.env.BRIK_HOME_MAX_TOKENS) || 18000;
    const genOpts = { maxTokens: homeMaxTokens, logMetrics: true, ...(creativeNotes.length ? { creativeNotes } : {}), ...(effectiveTheme ? { theme: effectiveTheme } : {}), ...(args.saasVisual ? { saasVisual: args.saasVisual } : {}), ...(args.variant ? { variant: args.variant } : {}) };
    const gen0 = await args.generator.generate(spec, genRoutes, genOpts);
    if (!gen0.ok) return err(gen0.error);
    const genHome = gen0.value.find((p) => p.route === '/' || p.route === '') ?? gen0.value[0];
    // QA BLOCKING minimo: SOLO "renderizzabile". Estetica/contrasto/copy/layout NON bloccano.
    if (!genHome || !isRenderableHtml(genHome.html)) return err(appError('CREATE_NOT_RENDERABLE', 'La home generata non e renderizzabile.', { retryable: true }));
    builtPages = gen0.value;
    builtReport = { level1: [], level2: [], flagged: [], buildSucceeded: true };
    console.log('    \u23f1 home_generation_done: ' + ((Date.now() - tGenPreview) / 1000).toFixed(1) + 's');
  } else {
    // PATH LEGACY (allRoutes): comportamento storico con QA+fix. Usato da wrapper e test.
    const built0 = await repairSite({ spec, routes: genRoutes, generator: args.generator, runQa: (p) => args.runQa(p, spec), maxRepairs, ...(creativeNotes.length ? { creativeNotes } : {}), ...(effectiveTheme ? { theme: effectiveTheme } : {}), ...(args.saasVisual ? { saasVisual: args.saasVisual } : {}), ...(args.variant ? { variant: args.variant } : {}) });
    if (!built0.ok) return err(built0.error);
    if (!built0.value.report.buildSucceeded) return err(appError('CREATE_NOT_GREEN', 'Non sono riuscito a portare la home al verde.', { retryable: true }));
    builtPages = built0.value.pages;
    builtReport = built0.value.report;
    console.log('    \u23f1 home_generation_time: ' + ((Date.now() - tGenPreview) / 1000).toFixed(1) + 's');
  }
  // Cleanup deterministico PRIMA di salvare la preview canonica (Fase 3 — Step 1):
  // rimuove emoji e data-count senza LLM, senza toccare struttura/copy/layout. La
  // versione ripulita è quella che l'utente vede, modifica e poi pubblica (WYSIWYG).
  const tCleanup = Date.now();
  const cleanedHome = cleanupPages(builtPages);
  console.log('    \u23f1 cleanup_time: ' + ((Date.now() - tCleanup) / 1000).toFixed(1) + 's');
  console.log('    \u{1F9F9} preview_cleanup: home ripulita (emoji, data-count) prima del salvataggio');
  // Placeholder PULITI per le route interne (esistono e sono navigabili; verranno
  // sostituite da completePages). Tracciate in pendingRoutes.
  const placeholders: SitePage[] = interiorRoutes.map((r) => ({ route: r.route, html: placeholderPageHtml(r.label || r.route) }));
  const cleanedPages = [...cleanedHome, ...placeholders];
  const pendingRoutes = interiorRoutes.map((r) => r.route);
  // La preview viene servita SENZA rigenerazione: lo dichiaro subito, in modo sincrono,
  // perche e vero a prescindere dall'esito della review (che ora gira in background).
  console.log('    \u{1F3AC} preview_no_regeneration: preview servita senza rigenerazione (rifinitura premium al publish)');

  // Anti-pattern detector (Fase 2) in PREVIEW: SOLO log, deterministico, costo zero.
  // Non tocca generazione ne QA, non blocca nulla; serve solo a dare visibilita nei
  // log su cosa pesca sui siti reali, per poterlo tarare prima di dargli influenza.
  try {
    const homeForScan = cleanedPages.find((p) => p.route === '/' || p.route === '') ?? cleanedPages[0];
    if (homeForScan && homeForScan.html) {
      const dctx: DesignScanContext = { theme: effectiveTheme ?? DEFAULT_THEME, industry: savedCreative ? savedCreative.direction.industry : 'generic', ...(savedCreative ? { creativeDirection: savedCreative.direction } : {}), pageType: 'home' };
      const report = scanDesignAntiPatterns(homeForScan.html, dctx);
      const cats = Object.entries(report.summary.byCategory).map(([k, v]) => `${k}:${v}`).join(' ');
      console.log('    \u{1F50E} design_antipatterns (preview, solo log): ' + report.summary.total + ' findings [high ' + report.summary.bySeverity.high + ' \u00b7 medium ' + report.summary.bySeverity.medium + ']' + (cats ? ' \u00b7 ' + cats : ''));
      // BRIK_DIAG: findings completi del detector (rule/cat/sev/conf/area/msg/fix).
      if (diagOn()) for (const ln of formatFindingsForLog(report)) console.log('    \u{1F52C} [diag] ' + ln);
    }
  } catch (e) { /* il detector e consultivo: un errore non disturba mai la preview */ }

  // Direttore in PREVIEW: SOLO score/log e ora in BACKGROUND (fire-and-forget). Non blocca
  // ne ritarda la risposta all'utente: createProject persiste e ritorna subito, e il punteggio
  // viene loggato quando arriva. Legge solo le pagine locali, non tocca lo store; se fallisce,
  // la preview resta comunque disponibile.
  if (args.review !== false) {
    const home = cleanedPages.find((p) => p.route === '/' || p.route === '') ?? cleanedPages[0];
    const homeHtml = (home && home.html) || '';
    void (async () => {
      try {
        const verdict = await reviewSite({ llm: args.llm, business: args.description, homeHtml, ...(typeof args.reviewMinScore === 'number' ? { minScore: args.reviewMinScore } : {}) });
        const s = verdict.scores;
        const breakdown = s ? ` [prestige ${s.prestige} \u00b7 fit ${s.industry_fit} \u00b7 gerarchia ${s.visual_hierarchy} \u00b7 sobrieta ${s.restraint} \u00b7 CTA ${s.conversion_clarity} \u00b7 anti-cliche ${s.anti_cliche} \u00b7 copy ${s.copy_quality} \u00b7 tema ${s.theme_alignment}]` : '';
        console.log('    \u{1F3AC} director_score: ' + verdict.score + '/10 \u00b7 director_decision: ' + verdict.decision + ' (background)' + breakdown);
        // BRIK_DIAG: issues complete del revisore. In preview NON gli passiamo la
        // sintesi del detector, quindi lo dichiaro per non confondere la diagnosi.
        if (diagOn()) {
          console.log('    \u{1F52C} [diag] REVIEW (preview/background) score=' + verdict.score + '/10 decision=' + verdict.decision + ' \u00b7 designFindings passati al revisore: nessuno');
          verdict.issues.forEach((iss, i) => console.log('    \u{1F52C} [diag]  issue ' + (i + 1) + '. ' + iss));
        }
      } catch (e) { /* la review in background non blocca mai la preview */ }
    })();
  }
  const statements = spec.criteria.map((c) => c.statement);
  const state: SiteState = {
    id: args.id,
    spec,
    statements,
    routes,
    pages: cleanedPages,
    status: 'preview',
    version: 1,
    updatedAt: now(),
    ...(savedCreative ? { creativeDirection: savedCreative } : {}),
    ...(pendingRoutes.length ? { pendingRoutes } : {}),
  };
  console.log('    \u23f1 home_save_start');
  const saved = await args.store.save({ schemaVersion: 2, state, history: [] });
  if (!saved.ok) return err(saved.error);
  console.log('    \u23f1 home_save_done \u00b7 preview_ready');
  console.log('    \u23f1 home_preview_ready_time: ' + ((Date.now() - tPlan) / 1000).toFixed(1) + 's \u00b7 pendingRoutes: ' + pendingRoutes.length + (pendingRoutes.length ? ' [' + pendingRoutes.join(',') + ']' : ''));
  const completion: CompletionPlan = {
    spec, interiorRoutes, maxRepairs,
    ...(effectiveTheme ? { theme: effectiveTheme } : {}),
    creativeNotes,
    ...(args.saasVisual ? { saasVisual: args.saasVisual } : {}),
    ...(args.variant ? { variant: args.variant } : {}),
  };
  return ok({ state, summary: summarizeSite(spec, routes), report: builtReport, completion });
}

/** Piano per completare in background le pagine interne con le stesse opzioni della home. */
export interface CompletionPlan {
  readonly spec: ProjectSpec;
  readonly interiorRoutes: readonly RouteInfo[];
  readonly maxRepairs: number;
  readonly theme?: string;
  readonly creativeNotes: readonly string[];
  readonly saasVisual?: string;
  readonly variant?: string;
}

/** Marcatore univoco di pagina placeholder (ground truth, indipendente da pendingRoutes). */
const PLACEHOLDER_MARK = 'data-brik-pending="1"';

/** Vero se l'HTML e un placeholder "pagina in preparazione" (non una pagina reale). */
export function isPlaceholderHtml(html: string): boolean {
  return !!html && html.includes(PLACEHOLDER_MARK);
}

/** Marcatore univoco di pagina fallback di publish (pagina reale "di emergenza", non contenuto vero). */
const FALLBACK_MARK = 'data-brik-fallback="1"';

/** Vero se l'HTML e una pagina di fallback del publish (renderizzabile ma NON contenuto reale). */
export function isFallbackHtml(html: string): boolean {
  return !!html && html.includes(FALLBACK_MARK);
}

/** QA BLOCKING minimo: la home e renderizzabile? (markup HTML presente e non vuota). */
export function isRenderableHtml(html: string): boolean {
  if (!html || !html.trim()) return false;
  const h = html.toLowerCase();
  if (!(h.includes('<html') || h.includes('<!doctype') || h.includes('<body') || h.includes('<main'))) return false;
  // contenuto non completamente assente: almeno un tag di contenuto oltre allo scheletro
  return /<(section|main|header|div|h1|h2|p|nav|article)\b/.test(h);
}

/** Race fra una promise e un timeout. Ritorna { timedOut: true } se scade. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  return Promise.race([
    p.then((value) => ({ timedOut: false as const, value })),
    new Promise<{ timedOut: true }>((res) => setTimeout(() => res({ timedOut: true as const }), ms)),
  ]);
}

/** HTML di un placeholder pulito (niente emoji/data-count) per una route interna. */
function placeholderPageHtml(label: string): string {
  const safe = String(label).replace(/[<>&]/g, '');
  return '<!doctype html><html lang="it" ' + PLACEHOLDER_MARK + '><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + safe + '</title>'
    + '<style>html,body{height:100%}body{margin:0;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e8eaed}main{text-align:center;padding:32px;max-width:520px}h1{font-size:18px;font-weight:600;margin:0 0 8px}p{opacity:.7;margin:0;font-size:14px}</style></head>'
    + '<body><main><h1>' + safe + '</h1><p>Pagina in preparazione. Sara pronta tra pochi secondi.</p></main></body></html>';
}

/**
 * Route ancora NON pronte: unione del metadato pendingRoutes e delle route le cui
 * pagine sono ancora placeholder (ground truth dall'HTML). Usata da publish e client
 * cosi il blocco non dipende solo dal metadato, che potrebbe essere disallineato.
 */
export function pendingRoutesOf(state: SiteState): string[] {
  const meta = new Set(state.pendingRoutes ?? []);
  for (const p of state.pages) if (isPlaceholderHtml(p.html)) meta.add(p.route);
  return [...meta];
}

/**
 * COMPLETAMENTO IN BACKGROUND delle pagine interne (Fast Preview, fase B).
 *
 * Genera le route interne con le stesse opzioni della home, applica QA e cleanup,
 * poi RICARICA lo stato piu recente e sostituisce SOLO le route ancora in
 * pendingRoutes: non tocca mai la home ne eventuali modifiche utente. Best-effort:
 * in caso di errore i placeholder restano e il publish e gestito a parte.
 */
export async function completePages(args: {
  readonly store: SiteStore;
  readonly id: string;
  readonly generator: SiteGenerator;
  readonly runQa: QaForSite;
  readonly completion: CompletionPlan;
}): Promise<Result<{ state: SiteState }>> {
  const { completion } = args;
  if (!completion.interiorRoutes.length) {
    const f0 = await args.store.load(args.id);
    if (f0.ok && f0.value && f0.value.state.pendingRoutes && f0.value.state.pendingRoutes.length) {
      const st: SiteState = { ...f0.value.state, pendingRoutes: [], updatedAt: now() };
      await args.store.save({ ...f0.value, state: st });
      return ok({ state: st });
    }
    return f0.ok && f0.value ? ok({ state: f0.value.state }) : err(appError('PROJECT_NOT_FOUND', 'Progetto non trovato: ' + args.id, { retryable: false }));
  }
  const tBg = Date.now();
  console.log('    \u23f1 background_pages_generation_started: ' + completion.interiorRoutes.length + ' routes [' + completion.interiorRoutes.map((r) => r.route).join(',') + ']');
  const interiorSet = new Set(completion.interiorRoutes.map((r) => r.route));
  // Route gia liberate dal rilascio anticipato (distinte da eventuali modifiche utente).
  const earlyCleared = new Set<string>();

  // Rilascio anticipato: appena la PRIMA generazione e pronta, salvo le pagine
  // renderizzabili sopra i placeholder e libero quelle route da pendingRoutes -> il sito
  // diventa pubblicabile senza attendere il loop QA/fix, che prosegue e rifinisce dopo.
  const onFirstRenderable = async (firstPages: readonly SitePage[]): Promise<void> => {
    const renderable = cleanupPages(
      firstPages.filter((p) => interiorSet.has(p.route) && isRenderableHtml(p.html) && !isPlaceholderHtml(p.html)),
    );
    if (!renderable.length) return;
    const byR = new Map<string, SitePage>(renderable.map((p) => [p.route, p]));
    const fe = await args.store.load(args.id);
    if (!fe.ok || !fe.value) return;
    const st = fe.value.state;
    const pendingNow = new Set(st.pendingRoutes ?? []);
    const pages = st.pages.map((p) => (pendingNow.has(p.route) && byR.has(p.route) ? byR.get(p.route)! : p));
    const remain = (st.pendingRoutes ?? []).filter((r) => !byR.has(r));
    for (const r of byR.keys()) earlyCleared.add(r);
    const early: SiteState = { ...st, pages, pendingRoutes: remain, updatedAt: now() };
    const es = await args.store.save({ ...fe.value, state: early });
    if (es.ok) console.log('    \u23f1 pages_early_ready: ' + ((Date.now() - tBg) / 1000).toFixed(1) + 's \u00b7 ' + renderable.length + ' route reali salvate \u00b7 pendingRoutes residue: ' + remain.length + (remain.length ? ' [' + remain.join(',') + ']' : ''));
  };

  const built = await repairSite({ spec: completion.spec, routes: completion.interiorRoutes, generator: args.generator, runQa: (p) => args.runQa(p, completion.spec), maxRepairs: completion.maxRepairs, onFirstRenderable, ...(completion.creativeNotes.length ? { creativeNotes: completion.creativeNotes } : {}), ...(completion.theme ? { theme: completion.theme } : {}), ...(completion.saasVisual ? { saasVisual: completion.saasVisual } : {}), ...(completion.variant ? { variant: completion.variant } : {}) });
  if (!built.ok) return err(built.error);
  console.log('    \u23f1 background_pages_generation_time: ' + ((Date.now() - tBg) / 1000).toFixed(1) + 's');
  const cleaned = cleanupPages(built.value.pages);
  const byRoute = new Map<string, SitePage>(cleaned.map((p) => [p.route, p]));

  // Merge SICURO: ricarico lo stato piu recente e sostituisco solo le route ancora
  // pendenti. Home e modifiche utente non vengono mai toccate.
  const f = await args.store.load(args.id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(appError('PROJECT_NOT_FOUND', 'Progetto non trovato: ' + args.id, { retryable: false }));
  const cur = f.value.state;
  // Applico le versioni rifinite alle sole route INTERNE che abbiamo gestito noi
  // (ancora pending o liberate dal rilascio anticipato). Home e modifiche utente intatte.
  const handled = new Set<string>([...(cur.pendingRoutes ?? []), ...earlyCleared]);
  const mergedPages = cur.pages.map((p) => (interiorSet.has(p.route) && handled.has(p.route) && byRoute.has(p.route) ? byRoute.get(p.route)! : p));
  const remaining = (cur.pendingRoutes ?? []).filter((r) => !byRoute.has(r));
  const merged: SiteState = { ...cur, pages: mergedPages, pendingRoutes: remaining, updatedAt: now() };
  const saved = await args.store.save({ ...f.value, state: merged });
  if (!saved.ok) return err(saved.error);
  console.log('    \u23f1 full_site_ready_time: ' + ((Date.now() - tBg) / 1000).toFixed(1) + 's \u00b7 pendingRoutes residue: ' + remaining.length);
  return ok({ state: merged });
}

/**
 * Attende che le pagine interne (pendingRoutes) siano pronte, fino a un timeout breve.
 * Usato dal publish: non genera nulla, osserva solo il completamento gia in corso.
 */
export async function awaitPagesReady(args: {
  readonly store: SiteStore;
  readonly id: string;
  readonly timeoutMs: number;
  readonly sleepMs?: number;
}): Promise<{ ready: boolean; pendingRoutes: readonly string[]; waited: boolean }> {
  const sleepMs = args.sleepMs ?? 1500;
  const first = await args.store.load(args.id);
  let pending = first.ok && first.value ? pendingRoutesOf(first.value.state) : [];
  if (!pending.length) return { ready: true, pendingRoutes: [], waited: false };
  const deadline = Date.now() + args.timeoutMs;
  while (pending.length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, sleepMs));
    const f = await args.store.load(args.id);
    pending = f.ok && f.value ? pendingRoutesOf(f.value.state) : pending;
  }
  return { ready: pending.length === 0, pendingRoutes: pending, waited: true };
}

/** Pagina REALE minima (NON placeholder: nessun marker pending) usata come fallback al publish. */
function fallbackPageHtml(label: string): string {
  const safe = String(label).replace(/[<>&]/g, '');
  return '<!doctype html><html lang="it" ' + FALLBACK_MARK + '><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + safe + '</title>'
    + '<style>html,body{height:100%}body{margin:0;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e8eaed}main{text-align:center;padding:32px;max-width:560px}h1{font-size:22px;font-weight:600;margin:0 0 10px}p{opacity:.75;margin:0 0 16px;font-size:15px}a{color:#c6a87d;text-decoration:none}</style></head>'
    + '<body><main><h1>' + safe + '</h1><p>Contenuto in arrivo.</p><p><a href="/">Torna alla home</a></p></main></body></html>';
}

/** Esegue fn su items con al massimo `limit` in volo; l'ordine dell'output rispetta items. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = new Array(n).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Publish-time: genera in PARALLELO (concorrenza BRIK_PUBLISH_ROUTE_CONCURRENCY, default 4) le route
 * ancora pending. Timeout per-route e timeout totale condiviso; se una route fallisce o va in timeout
 * usa una pagina fallback REALE (mai placeholder online). La generazione non scrive sullo store: i
 * risultati si raccolgono in memoria e si applicano con UN SOLO merge finale (reload -> replace ->
 * remove da pendingRoutes -> save), cosi non c'e race di scrittura. Termina SEMPRE.
 */
export async function finalizePendingRoutes(args: {
  readonly store: SiteStore;
  readonly id: string;
  readonly generator: SiteGenerator;
  readonly perRouteTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxTokens?: number;
  readonly concurrency?: number;
}): Promise<Result<{ state: SiteState; generated: readonly string[]; fallback: readonly string[] }>> {
  const f0 = await args.store.load(args.id);
  if (!f0.ok || !f0.value) return err(notFound(args.id));
  let state = f0.value.state;
  const pending = pendingRoutesOf(state);
  if (!pending.length) { console.log('  \u23f1 publish_pending_routes_count: 0 \u00b7 niente da generare'); return ok({ state, generated: [], fallback: [] }); }
  console.log('  \u23f1 publish_pending_routes_count: ' + pending.length + ' \u00b7 publish_routes_parallel_start: [' + pending.join(',') + ']');
  const perRoute = args.perRouteTimeoutMs ?? (Number(process.env.BRIK_PUBLISH_ROUTE_TIMEOUT_MS) || 45_000);
  const totalDeadline = Date.now() + (args.totalTimeoutMs ?? (Number(process.env.BRIK_PUBLISH_TOTAL_TIMEOUT_MS) || 180_000));
  const conc = args.concurrency ?? (Math.max(1, Number(process.env.BRIK_PUBLISH_ROUTE_CONCURRENCY) || 4));
  console.log('  \u23f1 publish_routes_parallel_concurrency: ' + conc);
  const spec = state.spec;
  const cd = state.creativeDirection;
  const creativeNotes = cd ? [...cd.notes] : [];
  const theme = cd && cd.theme ? cd.theme : undefined;
  const tok = args.maxTokens ?? (Number(process.env.BRIK_PUBLISH_ROUTE_MAX_TOKENS) || 14000);

  // Fase 1: generazione in parallelo, SENZA scritture sullo store. Ogni task e' isolato e ritorna
  // sempre un HTML (reale o fallback) -> nessuna route resta scoperta.
  const results = await mapLimit(pending, conc, async (route): Promise<{ route: string; html: string; fallback: boolean }> => {
    const label = (state.routes.find((r) => r.route === route) || { label: route }).label || route;
    const t = Date.now();
    console.log('  \u23f1 publish_route_start: ' + route);
    let html: string | null = null;
    const remaining = totalDeadline - Date.now();
    if (remaining <= 0) {
      console.log('  \u26d4 publish_total_timeout: budget esaurito, fallback per ' + route);
    } else {
      const budget = Math.max(1000, Math.min(perRoute, remaining));
      try {
        const gen = await withTimeout(args.generator.generate(spec, [{ route, label }], { maxTokens: tok, ...(creativeNotes.length ? { creativeNotes } : {}), ...(theme ? { theme } : {}) }), budget);
        if (gen.timedOut) {
          console.log('  \u23f1 publish_route_timeout: ' + route + ' oltre ' + (budget / 1000).toFixed(0) + 's');
        } else if (!gen.value.ok) {
          console.log('  \u26a0 publish_route_error: ' + route + ' ' + gen.value.error.code);
        } else {
          const page = gen.value.value.find((p) => p.route === route) ?? gen.value.value[0];
          if (page && isRenderableHtml(page.html) && !isPlaceholderHtml(page.html)) {
            const cleaned = cleanupPages([page])[0];
            html = (cleaned && cleaned.html) || page.html;
          }
        }
      } catch (e) { /* sotto: fallback */ }
    }
    const isFallback = !html;
    if (isFallback) { html = fallbackPageHtml(label); console.log('  \u26a0 publish_route_fallback: ' + route + ' (pagina semplice)'); }
    console.log('  \u23f1 publish_route_done: ' + route + ' ' + ((Date.now() - t) / 1000).toFixed(1) + 's' + (isFallback ? ' (fallback)' : ''));
    return { route, html: html as string, fallback: isFallback };
  });

  const genReal = results.filter((r) => !r.fallback).map((r) => r.route);
  const genFallback = results.filter((r) => r.fallback).map((r) => r.route);
  const byRoute = new Map<string, { html: string; fallback: boolean }>(results.map((r) => [r.route, { html: r.html, fallback: r.fallback }]));
  console.log('  \u23f1 publish_routes_parallel_done: generate ' + genReal.length + ', fallback ' + genFallback.length);

  // Fase 2: merge UNICO e DIFENSIVO. Ricarico lo stato piu recente (il background completePages
  // potrebbe aver gia scritto pagine REALI per queste route mentre il publish girava). Regole:
  //  - route non piu in pendingRoutes e gia reale -> non applico il risultato del publish (skip);
  //  - esiste gia html reale -> tengo quello del background, MAI fallback sopra una pagina reale;
  //  - altrimenti applico il risultato del publish (reale o fallback) e tolgo la route da pendingRoutes.
  const generated: string[] = [];
  const fallback: string[] = [];
  const cur = await args.store.load(args.id);
  if (cur.ok && cur.value) {
    const st = cur.value.state;
    const metaPending = new Set(st.pendingRoutes ?? []);
    const idxByRoute = new Map(st.pages.map((p, i) => [p.route, i] as const));
    const pages = [...st.pages];
    const stillPending = new Set(metaPending);
    for (const [route, res] of byRoute) {
      const curPage = idxByRoute.has(route) ? pages[idxByRoute.get(route)!] : undefined;
      const hasReal = !!curPage && isRenderableHtml(curPage.html) && !isPlaceholderHtml(curPage.html);
      if (!metaPending.has(route) && hasReal) {
        console.log('  \u2713 publish_route_merge_skip_already_ready: ' + route);
        generated.push(route);
        stillPending.delete(route);
        continue;
      }
      if (hasReal) {
        console.log('  \u2713 publish_route_merge_keep_background_result: ' + route);
        generated.push(route);
        stillPending.delete(route);
        continue;
      }
      const page = { route, html: res.html };
      if (idxByRoute.has(route)) pages[idxByRoute.get(route)!] = page; else pages.push(page);
      stillPending.delete(route);
      if (res.fallback) { fallback.push(route); console.log('  \u26a0 publish_route_merge_apply_fallback: ' + route); }
      else { generated.push(route); console.log('  \u2713 publish_route_merge_apply_generated: ' + route); }
    }
    const newPending = (st.pendingRoutes ?? []).filter((r) => stillPending.has(r));
    state = { ...st, pages, pendingRoutes: newPending, updatedAt: now() };
    await args.store.save({ ...cur.value, state });
    console.log('  \u23f1 publish_routes_merge_done: reali ' + generated.length + ', fallback ' + fallback.length);
  }
  console.log('  \u23f1 publish_pending_routes_remaining: ' + pendingRoutesOf(state).length);
  return ok({ state, generated, fallback });
}

/**
 * Crea il progetto COMPLETO (home + pagine interne) in modo sincrono.
 * Wrapper su createHome + completePages: comportamento storico (sito pronto, nessuna
 * route pendente), usato dai test e dove non serve il percorso fast.
 */
/**
 * Rifinitura della home in BACKGROUND (mai nel path critico): QA e, se rossa, fino a
 * maxFix tentativi di fix con timeout per tentativo. Se il fix riesce aggiorna la home;
 * se fallisce o va in timeout, lascia la preview visibile e marca previewIssues. Non
 * sovrascrive mai modifiche utente ne stati avanzati.
 */
export async function refineHome(args: {
  readonly store: SiteStore;
  readonly id: string;
  readonly generator: SiteGenerator;
  readonly runQa: QaForSite;
  readonly spec: ProjectSpec;
  readonly theme?: string;
  readonly creativeNotes?: readonly string[];
  readonly saasVisual?: string;
  readonly variant?: string;
  readonly fixTimeoutMs?: number;
  readonly maxFix?: number;
}): Promise<void> {
  try {
    const f0 = await args.store.load(args.id);
    if (!f0.ok || !f0.value) return;
    const st0 = f0.value.state;
    const home0 = st0.pages.find((p) => p.route === '/' || p.route === '');
    if (!home0 || !home0.html) return;
    const homeRoute: RouteInfo = st0.routes.find((r) => r.route === '/' || r.route === '') ?? { route: '/', label: 'Home' };
    const startHtml = home0.html;
    console.log('    \u23f1 qa_background_start');
    const tQa = Date.now();
    const qa0 = await args.runQa([home0], args.spec);
    if (!qa0.ok) { console.log('    \u26a0 qa_background_done: QA non eseguibile, preview invariata'); return; }
    let report = qa0.value;
    console.log('    \u23f1 qa_background_done: ' + ((Date.now() - tQa) / 1000).toFixed(1) + 's \u00b7 qa_time: ' + ((Date.now() - tQa) / 1000).toFixed(1) + 's \u2014 ' + (report.buildSucceeded ? 'verde' : 'rossa'));
    if (report.buildSucceeded) return;
    let pages: readonly SitePage[] = [home0];
    const maxFix = args.maxFix ?? 2;
    const fixTimeoutMs = args.fixTimeoutMs ?? 25_000;
    let i = 0;
    while (!report.buildSucceeded && i < maxFix) {
      const failures = [...report.level1, ...report.level2].filter((r) => !r.passed).map((r) => ({ kind: r.kind, detail: r.detail ?? ('fallito (' + r.criterionId + ')') }));
      console.log('    \u23f1 fix_background_start: tentativo ' + (i + 1) + ' (' + failures.length + ' problemi, timeout ' + (fixTimeoutMs / 1000).toFixed(0) + 's)');
      const tFix = Date.now();
      const fx = await withTimeout(args.generator.fix(args.spec, [homeRoute], pages, failures), fixTimeoutMs);
      if (fx.timedOut) { console.log('    \u23f1 fix_background_timeout: oltre ' + (fixTimeoutMs / 1000).toFixed(0) + 's, salto il fix, preview invariata'); break; }
      if (!fx.value.ok) { console.log('    \u26a0 fix_background error: ' + fx.value.error.code + ', preview invariata'); break; }
      pages = fx.value.value;
      const qa = await args.runQa(pages, args.spec);
      if (!qa.ok) break;
      report = qa.value;
      i++;
      console.log('    \u23f1 fix_background_done: tentativo ' + i + ' in ' + ((Date.now() - tFix) / 1000).toFixed(1) + 's \u2014 ' + (report.buildSucceeded ? 'verde' : 'rossa'));
    }
    // Applica SENZA mai sovrascrivere modifiche utente o stati avanzati.
    const f1 = await args.store.load(args.id);
    if (!f1.ok || !f1.value) return;
    const st = f1.value.state;
    const curHome = st.pages.find((p) => p.route === '/' || p.route === '');
    if (st.status !== 'preview' || !curHome || curHome.html !== startHtml) {
      console.log('    \u23f1 fix_background_skipped_merge: home modificata o stato avanzato, non tocco');
      return;
    }
    if (report.buildSucceeded) {
      const cleaned = cleanupPages(pages);
      const newHome = cleaned.find((p) => p.route === '/' || p.route === '') ?? cleaned[0];
      const pagesNew = st.pages.map((p) => ((p.route === '/' || p.route === '') && newHome ? { ...p, html: newHome.html } : p));
      const { previewIssues: _drop, ...rest } = st as SiteState & { previewIssues?: boolean };
      await args.store.save({ ...f1.value, state: { ...rest, pages: pagesNew, updatedAt: now() } });
      console.log('    \u23f1 fix_background_done: home aggiornata (verde)');
    } else {
      await args.store.save({ ...f1.value, state: { ...st, previewIssues: true, updatedAt: now() } });
      console.log('    \u26a0 qa_failed_non_blocking: preview resta visibile (preview_ready_with_issues)');
    }
  } catch (e) { /* il refine non deve mai disturbare la preview */ }
}

export async function createProject(args: Parameters<typeof createHome>[0]): Promise<Result<{ state: SiteState; summary: SiteSummary; report: QaReport }>> {
  const home = await createHome({ ...args, allRoutes: true });
  if (!home.ok) return err(home.error);
  return ok({ state: home.value.state, summary: home.value.summary, report: home.value.report });
}

/**
 * FINALIZZAZIONE PREMIUM (al publish).
 *
 * Esegue il gate vero del direttore creativo su un sito gia in preview: se la home
 * e sotto soglia, rigenera UNA volta usando la creative_direction SALVATA alla
 * creazione (cosi la direzione resta quella decisa, non ricostruita) e, se la
 * rigenerazione resta verde alla QA, persiste la versione migliorata. Va chiamata
 * dal flusso di publish PRIMA dello scan+deploy: publishProject leggera lo stato
 * gia aggiornato.
 *
 * E BEST-EFFORT e MONOTONA: o migliora il sito o lo lascia identico, non lo peggiora
 * e non blocca mai la pubblicazione. Qualunque errore -> si pubblica la preview.
 * Controllata da `enabled` (il server passa DIRECTOR_REVIEW && DIRECTOR_FINALIZE).
 */
export async function finalizeProject(args: {
  readonly store: SiteStore;
  readonly id: string;
  readonly llm: LLMProvider;
  readonly generator: SiteGenerator;
  readonly runQa: QaForSite;
  readonly reviewMinScore?: number;
  readonly enabled?: boolean;
}): Promise<Result<{ finalized: boolean; regenerated: boolean }>> {
  // Se la finalizzazione e disattivata, non faccio nulla: si pubblica la preview.
  if (args.enabled === false) return ok({ finalized: false, regenerated: false });

  const f = await args.store.load(args.id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(appError('PROJECT_NOT_FOUND', 'Progetto non trovato: ' + args.id, { retryable: false }));
  const cur = f.value.state;

  // Tutto best-effort: un errore qui non deve mai impedire il publish.
  try {
    console.log('    \u{1F3AC} premium_finalize_started: ' + args.id);
    const home = cur.pages.find((p) => p.route === '/' || p.route === '') ?? cur.pages[0];
    if (!home || !home.html) { console.log('    \u{1F3AC} fallback_to_preview: nessuna home da valutare'); return ok({ finalized: false, regenerated: false }); }

    // Direzione: preferisco quella SALVATA alla creazione; per i siti vecchi che ne sono
    // privi, ricostruisco best-effort dal titolo (fedelta minore, ma non blocca).
    const saved = cur.creativeDirection;
    const creativeNotes = saved ? [...saved.notes] : creativeNotesFor(creativeDirectionFromDescription(cur.spec.title || ''));
    // Tema: quello salvato; in mancanza, lo derivo dalle pagine esistenti (resta coerente).
    const theme = (saved && saved.theme) ? saved.theme : themeOfPages(cur.pages);

    // Anti-pattern detector (Fase 2) PRIMA della review: deterministico, non blocca.
    // Passo alla review SOLO una sintesi compatta (contesto, non verdetto). I findings
    // NON fanno mai partire una rigenerazione da soli: quella resta guidata dalla soglia.
    let designNotes: string[] = [];
    let designSummary: string[] = [];
    try {
      const dctx: DesignScanContext = { theme: theme ?? DEFAULT_THEME, industry: saved ? saved.direction.industry : 'generic', ...(saved ? { creativeDirection: saved.direction } : {}), pageType: 'home' };
      const report = scanDesignAntiPatterns(home.html, dctx);
      designSummary = summarizeForReview(report, 5);
      designNotes = findingsToDirectorNotes(report, { minSeverity: 'medium', max: 5 });
      console.log('    \u{1F50E} design_antipatterns (publish): ' + report.summary.total + ' findings [high ' + report.summary.bySeverity.high + ' \u00b7 medium ' + report.summary.bySeverity.medium + ']');
      // BRIK_DIAG: findings completi + sintesi effettivamente passata al revisore.
      if (diagOn()) {
        for (const ln of formatFindingsForLog(report)) console.log('    \u{1F52C} [diag] ' + ln);
        console.log('    \u{1F52C} [diag] DETECTOR\u2192REVIEW summary passata (designFindings=' + designSummary.length + '):');
        designSummary.forEach((s) => console.log('    \u{1F52C} [diag]  - ' + s));
      }
    } catch (e) { /* detector consultivo: un errore non disturba il publish */ }

    const verdict = await reviewSite({ llm: args.llm, business: cur.spec.title || '', homeHtml: home.html, ...(typeof args.reviewMinScore === 'number' ? { minScore: args.reviewMinScore } : {}), ...(designSummary.length ? { designFindings: designSummary } : {}) });
    const sc = verdict.scores;
    const breakdown = sc ? ` [prestige ${sc.prestige} \u00b7 fit ${sc.industry_fit} \u00b7 gerarchia ${sc.visual_hierarchy} \u00b7 sobrieta ${sc.restraint} \u00b7 CTA ${sc.conversion_clarity} \u00b7 anti-cliche ${sc.anti_cliche} \u00b7 copy ${sc.copy_quality} \u00b7 tema ${sc.theme_alignment}]` : '';
    console.log('    \u{1F3AC} director_score: ' + verdict.score + '/10 \u00b7 director_decision: ' + verdict.decision + breakdown);
    // BRIK_DIAG: score+assi e issues complete del revisore (al publish la sintesi È passata).
    if (diagOn()) {
      console.log('    \u{1F52C} [diag] REVIEW (publish) score=' + verdict.score + '/10 decision=' + verdict.decision + (breakdown ? ' assi:' + breakdown : ''));
      console.log('    \u{1F52C} [diag] REVIEW issues (' + verdict.issues.length + '):');
      verdict.issues.forEach((iss, i) => console.log('    \u{1F52C} [diag]  ' + (i + 1) + '. ' + iss));
    }

    // Sopra soglia: niente rigenerazione, si pubblica subito la preview (gia di livello).
    // (La decisione resta SOLO del revisore/soglia: il detector non puo forzare un regen.)
    if (verdict.pass || !verdict.issues.length) {
      console.log('    \u{1F3AC} premium_regeneration_skipped: sito gia a livello, publish veloce');
      return ok({ finalized: true, regenerated: false });
    }

    // Sotto soglia: UNA rigenerazione mirata. Unisco le note del direttore a quelle del
    // detector (gia limitate a 5, ordinate per severity+confidence), deduplicate.
    const mergedNotes = [...verdict.issues, ...designNotes.filter((n) => !verdict.issues.includes(n))];
    // BRIK_DIAG: il trigger è la review sotto soglia, NON il detector; e le note del
    // detector vengono loggate SOLO qui, cioè solo quando vengono effettivamente usate.
    if (diagOn()) {
      const minS = typeof args.reviewMinScore === 'number' ? args.reviewMinScore : 7;
      console.log('    \u{1F52C} [diag] premium_regeneration_trigger: review_below_threshold (decision=' + verdict.decision + ', score=' + verdict.score + ' < min=' + minS + ') \u2014 NON detector');
      console.log('    \u{1F52C} [diag] directorNotes dal detector usate (' + designNotes.length + '): ' + (designNotes.join(' | ') || '\u2014'));
      console.log('    \u{1F52C} [diag] directorNotes finali (review + detector, dedup) (' + mergedNotes.length + '): ' + mergedNotes.join(' | '));
    }
    const tRe = Date.now();
    const retry = await repairSite({ spec: cur.spec, routes: cur.routes, generator: args.generator, runQa: (p) => args.runQa(p, cur.spec), maxRepairs: 3, directorNotes: mergedNotes, ...(creativeNotes.length ? { creativeNotes } : {}), ...(theme ? { theme } : {}) });
    console.log('    \u23f1 premium_regeneration_time: ' + ((Date.now() - tRe) / 1000).toFixed(1) + 's');

    if (!retry.ok || !retry.value.report.buildSucceeded) {
      console.log('    \u{1F3AC} fallback_to_preview: rigenerazione non verde, pubblico la preview');
      return ok({ finalized: true, regenerated: false });
    }

    // Rigenerazione verde: persisto la versione migliorata (nuova versione, stesso stato).
    const improved: SiteState = {
      ...cur,
      pages: retry.value.pages,
      version: cur.version + 1,
      updatedAt: now(),
    };
    const saveRes = await args.store.save({ schemaVersion: 2, state: improved, history: f.value.history });
    if (!saveRes.ok) { console.log('    \u{1F3AC} fallback_to_preview: salvataggio fallito, pubblico la preview'); return ok({ finalized: true, regenerated: false }); }
    console.log('    \u{1F3AC} premium finalize: versione migliorata persistita (v' + improved.version + ')');
    return ok({ finalized: true, regenerated: true });
  } catch (e) {
    console.log('    \u{1F3AC} fallback_to_preview: errore in finalizzazione, pubblico la preview');
    return ok({ finalized: false, regenerated: false });
  }
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
  /** Materiale reale allegato per QUESTA modifica (testo). Va al generatore, non a planEdit. */
  readonly content?: string;
  /** Tetto modifiche di prova: oltre questo, se non entitled, l'edit è bloccato. <=0 o assente = nessun cap. */
  readonly editCap?: number;
}): Promise<Result<{ accepted: boolean; state: SiteState; conflicts: readonly EditConflict[]; changes: readonly string[] }>> {
  const f = await args.store.load(args.id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(notFound(args.id));
  const cur = f.value.state;
  if (cur.status === 'locked') {
    return err(appError('SITE_LOCKED', 'Il sito è in pausa: va riattivato prima di poterlo modificare.', { retryable: false }));
  }
  const editCap = args.editCap ?? 0;
  if (editCap > 0 && !cur.entitled && (cur.editCount ?? 0) >= editCap) {
    return err(appError('EDIT_CAP_REACHED', `Hai usato tutte le ${editCap} modifiche della prova. Riattiva il sito per continuare a modificarlo.`, { retryable: false }));
  }

  // Il materiale della create non si trascina nelle modifiche (i dati reali sono già nelle pagine);
  // qui conta solo l'eventuale allegato di QUESTA modifica.
  const { content: _prevContent, ...specBase } = cur.spec;
  const material = (args.content ?? '').trim();
  const contentPatch = material ? { content: material.slice(0, 16000) } : {};

  // 1+2) Il contratto (planEdit) e la rigenerazione sono INDIPENDENTI: il generatore
  // non usa i criteri, li usa solo la QA. Eseguirli in parallelo nasconde il tempo di
  // planEdit sotto quello, piu lungo, della rigenerazione. Il generatore riceve i
  // criteri attuali (che ignora); la QA userà quelli nuovi.
  const genSpec: ProjectSpec = { ...specBase, ...contentPatch };
  const [plan, edited] = await Promise.all([
    planEdit({ instruction: args.instruction, spec: cur.spec, routes: cur.routes, llm: args.llm }),
    args.generator.edit(genSpec, cur.routes, cur.pages, args.instruction),
  ]);
  if (!plan.ok) return err(plan.error);
  if (!edited.ok) return err(edited.error);

  const newSpec: ProjectSpec = { ...specBase, criteria: [...plan.value.criteria], ...contentPatch };

  // 3) QA MIRATA. Le pagine non toccate dal generatore sono byte-identiche a prima,
  // quindi ri-verificarle e ridondante. Verifichiamo l'unione di:
  //  (a) le route che il generatore ha effettivamente cambiato;
  //  (b) le route i cui requisiti sono NUOVI o CAMBIATI rispetto a prima — cosi non
  //      sfugge una modifica richiesta che il generatore NON ha applicato (criterio
  //      nuovo su una pagina rimasta uguale: senza questo verrebbe dato per "fatto").
  // Gli altri criteri (pagine identiche, gia verificate) si saltano: meno lavoro QA.
  const before = new Map(cur.pages.map((p) => [p.route, p.html] as const));
  const mustVerify = new Set<string>();
  for (const p of edited.value) if (before.get(p.route) !== p.html) mustVerify.add(p.route);

  const critKey = (c: AcceptanceCriterion): string => {
    const ck = c.check;
    const route = ck && 'route' in ck ? ck.route : '';
    return (ck ? ck.kind : 'none') + '|' + route + '|' + c.statement.trim();
  };
  const oldKeys = new Set(cur.spec.criteria.map(critKey));
  for (const c of newSpec.criteria) {
    const ck = c.check;
    if (ck && 'route' in ck && !oldKeys.has(critKey(c))) mustVerify.add(ck.route);
  }

  const qaCriteria = newSpec.criteria.filter((c) => {
    const ck = c.check;
    if (!ck) return true; // senza check: non costa nulla alla QA
    if ('route' in ck) return mustVerify.has(ck.route);
    return true; // criteri cross-page (es. navigation): sempre verificati
  });
  const qaSpec: ProjectSpec = { ...newSpec, criteria: qaCriteria };

  // Verifica le pagine generate contro il contratto (mirato).
  const qa = await args.runQa(edited.value, qaSpec);
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
    editCount: (cur.editCount ?? 0) + 1,
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
  readonly host?: SiteHostingProvider;
  /** Trasformazione applicata alle pagine SOLO per il deploy (es. inline foto utente). */
  readonly materialize?: (pages: readonly SitePage[]) => readonly SitePage[];
  /** Giorni di prova: alla PRIMA pubblicazione (sito non entitled) imposta la scadenza. */
  readonly trialDays?: number;
}): Promise<Result<{ published: boolean; state: SiteState; report: SiteScanReport }>> {
  const f = await args.store.load(args.id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(notFound(args.id));
  const cur = f.value.state;
  if (cur.status === 'locked' && !cur.entitled) {
    return err(appError('SITE_LOCKED', 'Il sito è in pausa. Riattivalo prima di ripubblicare.', { retryable: false }));
  }
  if (cur.status !== 'approved') {
    return err(appError('NOT_APPROVED', 'Approva il progetto prima di pubblicare (stato attuale: ' + cur.status + ').', { retryable: false }));
  }
  const report = scanSite(cur.pages, args.scanner);
  if (report.blocked) return ok({ published: false, state: cur, report });

  // Deploy sull'host (se configurato), poi marca pubblicato con l'URL live.
  let url = cur.url;
  if (args.host) {
    const deployPages = args.materialize ? args.materialize(cur.pages) : cur.pages;
    const deployed = await args.host.deploy({ siteId: cur.id, pages: deployPages });
    if (!deployed.ok) return err(deployed.error);
    url = deployed.value.url;
  }

  // Prova: la imposto solo alla prima pubblicazione di un sito non abilitato; non si
  // riavvia ripubblicando (altrimenti si aggirerebbe il paywall modificando e ripubblicando).
  const trialEndsAt =
    !cur.entitled && !cur.trialEndsAt && args.trialDays && args.trialDays > 0
      ? new Date(Date.now() + args.trialDays * 86_400_000).toISOString()
      : cur.trialEndsAt;

  const state: SiteState = {
    ...cur,
    status: 'published',
    updatedAt: now(),
    publishedAt: now(),
    ...(url ? { url } : {}),
    ...(trialEndsAt ? { trialEndsAt } : {}),
  };
  const saved = await args.store.save({ ...f.value, state });
  if (!saved.ok) return err(saved.error);
  return ok({ published: true, state, report });
}

/** Fase della prova/abilitazione, derivata dallo stato. Pura: usata da sweep, vista e UI. */
export type TrialPhase = 'none' | 'trial' | 'expired' | 'entitled';
export function trialPhase(
  state: Pick<SiteState, 'entitled' | 'trialEndsAt'>,
  now: number = Date.now(),
): { phase: TrialPhase; daysLeft: number } {
  if (state.entitled) return { phase: 'entitled', daysLeft: 0 };
  if (!state.trialEndsAt) return { phase: 'none', daysLeft: 0 };
  const ms = Date.parse(state.trialEndsAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return { phase: 'expired', daysLeft: 0 };
  return { phase: 'trial', daysLeft: Math.ceil(ms / 86_400_000) };
}

/**
 * LOCK (fine prova, sito non pagato): mette in pausa SENZA cancellare. Deploya una
 * pagina "in pausa" sullo stesso progetto host (così l'URL pubblico va offline ma il
 * dominio resta), mantenendo intatte le pagine reali per il ripristino.
 */
export async function lockProject(args: {
  readonly store: SiteStore;
  readonly id: string;
  readonly host?: SiteHostingProvider;
  readonly placeholderPages: readonly SitePage[];
}): Promise<Result<SiteState>> {
  const f = await args.store.load(args.id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(notFound(args.id));
  const cur = f.value.state;
  if (cur.status === 'locked') return ok(cur); // già in pausa
  if (cur.entitled) return ok(cur); // abilitato: non si blocca
  if (args.host) {
    const deployed = await args.host.deploy({ siteId: cur.id, pages: args.placeholderPages });
    if (!deployed.ok) return err(deployed.error);
  }
  const state: SiteState = { ...cur, status: 'locked', updatedAt: now() };
  const saved = await args.store.save({ ...f.value, state });
  if (!saved.ok) return err(saved.error);
  return ok(state);
}

/**
 * UNLOCK (riattivazione/pagamento): segna il sito come abilitato (niente più lock) e
 * ri-deploya le pagine reali, riportandolo online. Pre-Stripe lo invoca l'operatore;
 * a regime lo chiamerà il webhook di pagamento.
 */
export async function unlockProject(args: {
  readonly store: SiteStore;
  readonly id: string;
  readonly host?: SiteHostingProvider;
  readonly materialize?: (pages: readonly SitePage[]) => readonly SitePage[];
}): Promise<Result<SiteState>> {
  const f = await args.store.load(args.id);
  if (!f.ok) return err(f.error);
  if (!f.value) return err(notFound(args.id));
  const cur = f.value.state;
  let url = cur.url;
  if (args.host) {
    const deployPages = args.materialize ? args.materialize(cur.pages) : cur.pages;
    const deployed = await args.host.deploy({ siteId: cur.id, pages: deployPages });
    if (!deployed.ok) return err(deployed.error);
    url = deployed.value.url;
  }
  const state: SiteState = {
    ...cur,
    status: 'published',
    entitled: true,
    updatedAt: now(),
    publishedAt: cur.publishedAt ?? now(),
    ...(url ? { url } : {}),
  };
  const saved = await args.store.save({ ...f.value, state });
  if (!saved.ok) return err(saved.error);
  return ok(state);
}
