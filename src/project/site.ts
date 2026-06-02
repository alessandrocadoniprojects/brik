/** Helper per siti multi-pagina: scansione di sicurezza e riassunto, su tutte le pagine. */
import type { ProjectSpec, SitePage, SiteRoute } from '@core';
import type { SecurityScanner, Finding } from '../security/scanner.js';

export interface SiteScanReport {
  readonly byRoute: readonly { readonly route: string; readonly findings: readonly Finding[] }[];
  readonly blocked: boolean;
}

/** Scansiona ogni pagina; blocca se una qualsiasi pagina e bloccata. */
export function scanSite(pages: readonly SitePage[], scanner: SecurityScanner): SiteScanReport {
  const byRoute = pages.map((p) => ({ route: p.route, findings: scanner.scan(p.html).findings }));
  const blocked = byRoute.some((r) => r.findings.some((f) => f.severity === 'high' || f.severity === 'medium'));
  return { byRoute, blocked };
}

export interface SiteSummary {
  readonly title: string;
  readonly pages: readonly {
    readonly route: string;
    readonly label: string;
    readonly contents: readonly string[];
    readonly form?: { readonly fields: readonly string[]; readonly confirmation: string };
    readonly mobileChecked: boolean;
  }[];
  readonly manualConfirm: readonly string[];
}

/** Riassunto in parole semplici, per pagina, derivato dai criteri. */
export function summarizeSite(spec: ProjectSpec, routes: readonly SiteRoute[]): SiteSummary {
  const manual: string[] = [];
  for (const c of spec.criteria) if (!c.check) manual.push(c.statement);

  const pages = routes.map((r) => {
    const contents: string[] = [];
    let form: { fields: string[]; confirmation: string } | undefined;
    let mobile = false;
    for (const c of spec.criteria) {
      const k = c.check;
      if (!k) continue;
      if (k.kind === 'content-present' && k.route === r.route) contents.push(k.text);
      else if (k.kind === 'form-submission' && k.route === r.route) form = { fields: k.fields.map((f) => f.label), confirmation: k.confirmationText };
      else if (k.kind === 'responsive' && k.route === r.route) mobile = true;
    }
    return { route: r.route, label: r.label, contents, mobileChecked: mobile, ...(form ? { form } : {}) };
  });

  return { title: spec.title, pages, manualConfirm: manual };
}
