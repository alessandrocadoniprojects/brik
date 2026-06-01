/**
 * Anteprima per APPROVAZIONE (Fase 2).
 *
 * Il motore produce la pagina REALE già verificata dalla QA (non un bozzetto) e
 * un RIASSUNTO in parole semplici di cosa contiene, derivato in modo
 * deterministico dai criteri. L'utente non-tecnico approva questo pacchetto
 * prima della pubblicazione. I criteri soggettivi (senza check) vengono elencati
 * a parte come "da confermare a mano": il motore non finge di averli verificati.
 */

import {
  type ProjectSpec,
  type CodeGenerator,
  type LLMProvider,
  type QaReport,
  type Result,
  ok,
  err,
} from '@core';
import { repairLoop } from './repair.js';

export interface PreviewSummary {
  readonly title: string;
  /** Testi chiave che devono comparire (dai content-present). */
  readonly contents: readonly string[];
  /** Form, se previsto: etichette campi + testo di conferma. */
  readonly form?: { readonly fields: readonly string[]; readonly confirmation: string };
  /** La pagina è stata verificata su mobile. */
  readonly mobileChecked: boolean;
  /** Criteri soggettivi non auto-verificabili: l'utente li conferma a mano. */
  readonly manualConfirm: readonly string[];
}

export interface PreviewPackage {
  /** Pagina reale, già passata dalla QA, pronta da mostrare e approvare. */
  readonly html: string;
  readonly report: QaReport;
  readonly summary: PreviewSummary;
  /** Correzioni applicate per arrivare al verde (0 = al primo colpo). */
  readonly iterations: number;
}

/** Riassunto in parole semplici, derivato dai criteri (niente LLM, niente finzioni). */
export function summarizeSpec(spec: ProjectSpec): PreviewSummary {
  const contents: string[] = [];
  let form: { fields: string[]; confirmation: string } | undefined;
  let mobile = false;
  const manual: string[] = [];

  for (const c of spec.criteria) {
    if (!c.check) {
      manual.push(c.statement);
      continue;
    }
    const k = c.check;
    if (k.kind === 'content-present') contents.push(k.text);
    else if (k.kind === 'form-submission') {
      form = { fields: k.fields.map((f) => f.label), confirmation: k.confirmationText };
    } else if (k.kind === 'responsive') mobile = true;
  }

  return {
    title: spec.title,
    contents,
    mobileChecked: mobile,
    manualConfirm: manual,
    ...(form ? { form } : {}),
  };
}

/**
 * Genera la pagina, la porta al verde con l'auto-fix e restituisce il pacchetto
 * approvabile. La pubblicazione avviene SOLO dopo l'approvazione dell'utente
 * (passo separato, lato app): qui ci si ferma all'anteprima.
 */
export async function buildPreview(args: {
  readonly spec: ProjectSpec;
  readonly codegen: CodeGenerator;
  readonly llm: LLMProvider;
  readonly runQa: (html: string) => Promise<Result<QaReport>>;
  readonly maxRepairs?: number;
}): Promise<Result<PreviewPackage>> {
  const gen = await args.codegen.generate(args.spec);
  if (!gen.ok) return err(gen.error);
  const initialHtml = gen.value.files.find((f) => f.path === 'index.html')?.contents ?? '';

  const outcome = await repairLoop({
    spec: args.spec,
    llm: args.llm,
    initialHtml,
    runQa: args.runQa,
    maxRepairs: args.maxRepairs ?? 3,
  });
  if (!outcome.ok) return err(outcome.error);

  return ok({
    html: outcome.value.html,
    report: outcome.value.report,
    summary: summarizeSpec(args.spec),
    iterations: outcome.value.iterations,
  });
}
