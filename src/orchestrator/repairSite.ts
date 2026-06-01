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
}): Promise<Result<SiteRepairResult>> {
  const maxRepairs = args.maxRepairs ?? 3;

  const first = await args.generator.generate(args.spec, args.routes);
  if (!first.ok) return err(first.error);
  let pages = first.value;

  let qa = await args.runQa(pages);
  if (!qa.ok) return err(qa.error);
  let report = qa.value;

  let i = 0;
  while (!report.buildSucceeded && i < maxRepairs) {
    const failures = [...report.level1, ...report.level2]
      .filter((r) => !r.passed)
      .map((r) => ({ kind: r.kind, detail: r.detail ?? `fallito (${r.criterionId})` }));

    const fixed = await args.generator.fix(args.spec, args.routes, pages, failures);
    if (!fixed.ok) return err(fixed.error);
    pages = fixed.value;

    qa = await args.runQa(pages);
    if (!qa.ok) return err(qa.error);
    report = qa.value;
    i += 1;
  }

  return ok({ pages, report, iterations: i });
}
