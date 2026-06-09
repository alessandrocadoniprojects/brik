/**
 * Loop di build+riparazione MULTI-PAGINA (Fase 3 / tappa 1).
 * Analogo a repairLoop ma su un sito (insieme di pagine): genera, QA, e se
 * fallisce chiede al generatore di correggere TUTTE le pagine coi problemi
 * della QA, fino al verde o a maxRepairs.
 */
import { type SitePage, type QaReport, type Result, ok, err } from '@core';
import type { SiteGenerator, RouteInfo } from '../adapters/anthropic/siteGenerator.js';
import type { ProjectSpec } from '@core';

export interface SiteRepairResult {
  readonly pages: readonly SitePage[];
  readonly report: QaReport;
  readonly iterations: number;
}

export async function repairSite(args: {
  readonly spec: ProjectSpec;
  readonly routes: readonly RouteInfo[];
  readonly generator: SiteGenerator;
  readonly runQa: (pages: readonly SitePage[]) => Promise<Result<QaReport>>;
  readonly maxRepairs?: number;
  readonly theme?: string;
  readonly saasVisual?: string;
  readonly variant?: string;
  /** Note del direttore creativo per UNA rigenerazione mirata (gate qualità). */
  readonly directorNotes?: readonly string[];
  /** Direzione creativa (settore/emozione/pattern/CTA/anti-cliché): orienta la generazione. */
  readonly creativeNotes?: readonly string[];
  /** Hook chiamato UNA sola volta subito dopo la PRIMA generazione, prima del loop QA/fix.
   *  Best-effort (eventuali errori non bloccano la rifinitura). Usato da completePages per
   *  salvare e rilasciare subito le pagine renderizzabili senza attendere QA/fix. */
  readonly onFirstRenderable?: (pages: readonly SitePage[]) => Promise<void>;
}): Promise<Result<SiteRepairResult>> {
  const maxRepairs = args.maxRepairs ?? 3;

  const genOpts = (args.theme || args.saasVisual || args.variant || (args.directorNotes && args.directorNotes.length) || (args.creativeNotes && args.creativeNotes.length))
    ? {
        ...(args.theme ? { theme: args.theme } : {}),
        ...(args.saasVisual ? { saasVisual: args.saasVisual } : {}),
        ...(args.variant ? { variant: args.variant } : {}),
        ...(args.directorNotes && args.directorNotes.length ? { directorNotes: args.directorNotes } : {}),
        ...(args.creativeNotes && args.creativeNotes.length ? { creativeNotes: args.creativeNotes } : {}),
      }
    : undefined;
  const tGen = Date.now();
  const first = await args.generator.generate(args.spec, args.routes, genOpts);
  if (!first.ok) return err(first.error);
  let pages = first.value;
  const chars = pages.reduce((n, p) => n + ((p.html && p.html.length) || 0), 0);
  console.log(`    \u23f1 generate: ${((Date.now() - tGen) / 1000).toFixed(1)}s — ${pages.length} pagine, ${Math.round(chars / 1000)}k caratteri`);

  // Rilascio anticipato: le pagine appena generate sono gia renderizzabili; lasciamo
  // che il chiamante le salvi/pubblichi subito mentre il loop QA/fix prosegue.
  if (args.onFirstRenderable) {
    try { await args.onFirstRenderable(pages); } catch { /* best-effort: non blocca la rifinitura */ }
  }

  const tQa = Date.now();
  let qa = await args.runQa(pages);
  if (!qa.ok) return err(qa.error);
  let report = qa.value;
  console.log(`    \u23f1 qa#0: ${((Date.now() - tQa) / 1000).toFixed(1)}s — ${report.buildSucceeded ? 'verde' : 'rossa'}`);

  let i = 0;
  while (!report.buildSucceeded && i < maxRepairs) {
    const failures = [...report.level1, ...report.level2]
      .filter((r) => !r.passed)
      .map((r) => ({ kind: r.kind, detail: r.detail ?? `fallito (${r.criterionId})` }));

    const tFix = Date.now();
    const fixed = await args.generator.fix(args.spec, args.routes, pages, failures);
    if (!fixed.ok) return err(fixed.error);
    pages = fixed.value;
    console.log(`    \u23f1 fix#${i + 1}: ${((Date.now() - tFix) / 1000).toFixed(1)}s — ${failures.length} problemi`);

    const tQa2 = Date.now();
    qa = await args.runQa(pages);
    if (!qa.ok) return err(qa.error);
    report = qa.value;
    console.log(`    \u23f1 qa#${i + 1}: ${((Date.now() - tQa2) / 1000).toFixed(1)}s — ${report.buildSucceeded ? 'verde' : 'rossa'}`);
    i += 1;
  }

  return ok({ pages, report, iterations: i });
}
