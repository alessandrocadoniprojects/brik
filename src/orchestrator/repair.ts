/**
 * Loop di AUTO-FIX (riparazione guidata dai test).
 *
 * Chiude il ciclo del prodotto: se la QA fallisce, i fallimenti tornano
 * all'LLM come istruzioni di correzione, si rigenera il codice e si ri-verifica,
 * fino a `maxRepairs` giri. La condizione di stop è OGGETTIVA (gate verde),
 * non un giudizio del modello: il modello propone, i test decidono.
 *
 * È agnostico rispetto al motore di QA (jsdom o browser reale): riceve una
 * funzione `runQa(html)` e non sa come viene eseguita.
 */

import {
  type ProjectSpec,
  type QaReport,
  type LLMProvider,
  type Result,
  ok,
  err,
  appError,
} from '@core';

export interface RepairOutcome {
  readonly html: string;
  readonly report: QaReport;
  /** Quante correzioni sono state applicate (0 = passato al primo colpo). */
  readonly iterations: number;
}

/** Estrae l'HTML dalla risposta del modello, togliendo eventuali fence markdown. */
function extractHtml(raw: string): string | null {
  let s = raw.trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const start = s.search(/<!doctype html|<html/i);
  if (start === -1) return null;
  return s.slice(start);
}

const countFail = (r: QaReport): number =>
  [...r.level1, ...r.level2].filter((x) => !x.passed).length;

/** Elenco leggibile dei check falliti, con la richiesta originale come contesto. */
function failuresText(spec: ProjectSpec, report: QaReport): string {
  const byId = new Map(spec.criteria.map((c) => [c.id, c]));
  const lines: string[] = [];
  for (const r of [...report.level1, ...report.level2]) {
    if (r.passed) continue;
    const c = byId.get(r.criterionId);
    const ctx = c ? ` (richiesta: ${c.statement})` : '';
    lines.push(`- [${r.kind}] ${r.detail ?? 'check fallito'}${ctx}`);
  }
  return lines.join('\n');
}

export async function repairLoop(args: {
  readonly spec: ProjectSpec;
  readonly llm: LLMProvider;
  readonly initialHtml: string;
  readonly runQa: (html: string) => Promise<Result<QaReport>>;
  readonly maxRepairs?: number;
  readonly onStep?: (info: { iteration: number; buildSucceeded: boolean; failing: number }) => void;
}): Promise<Result<RepairOutcome>> {
  const maxRepairs = args.maxRepairs ?? 3;

  let html = args.initialHtml;
  const first = await args.runQa(html);
  if (!first.ok) return err(first.error);
  let report = first.value;
  let iterations = 0;
  args.onStep?.({ iteration: 0, buildSucceeded: report.buildSucceeded, failing: countFail(report) });

  while (!report.buildSucceeded && iterations < maxRepairs) {
    const system =
      "Sei un correttore di siti web. Ricevi un HTML e l'elenco dei problemi rilevati da test automatici. " +
      'Restituisci l\'HTML COMPLETO corretto e autosufficiente (CSS e JS inline), usando i testi ESATTI richiesti. ' +
      'Rispondi SOLO con il codice HTML: nessuna spiegazione, nessun blocco markdown.';
    const prompt =
      `HTML attuale:\n${html}\n\n` +
      `Problemi da risolvere (devono sparire TUTTI):\n${failuresText(args.spec, report)}`;

    const fix = await args.llm.complete({ system, prompt, tier: 'balanced', maxTokens: 8192 });
    if (!fix.ok) return err(fix.error);

    const next = extractHtml(fix.value.text);
    if (!next) return err(appError('REPAIR_EMPTY', 'La correzione non ha prodotto HTML valido.', { retryable: true }));
    html = next;

    const re = await args.runQa(html);
    if (!re.ok) return err(re.error);
    report = re.value;
    iterations += 1;
    args.onStep?.({ iteration: iterations, buildSucceeded: report.buildSucceeded, failing: countFail(report) });
  }

  return ok({ html, report, iterations });
}
