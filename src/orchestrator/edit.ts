/**
 * Modifica guidata + GATE DI REGRESSIONE (Fase 2).
 *
 * L'utente chiede un cambio in parole semplici; l'LLM lo applica all'HTML
 * approvato. Poi la QA rigira sui criteri ESISTENTI: sono il contratto.
 *  - se restano tutti verdi  -> modifica ACCETTATA (pagina aggiornata)
 *  - se la modifica ne rompe uno -> RIFIUTATA: la pagina resta invariata e si
 *    elencano i conflitti col requisito. Non si "aggiusta" forzando indietro la
 *    modifica (il fixer non conosce l'intento del cambio) né si rompe il
 *    contratto in silenzio. Cambiare un requisito confermato è un aggiornamento
 *    del requisito (re-intake), non una modifica libera.
 */

import {
  type ProjectSpec,
  type LLMProvider,
  type QaReport,
  type Result,
  ok,
  err,
  appError,
} from '@core';
import { extractHtml } from './repair.js';

export interface EditConflict {
  readonly criterionId: string;
  readonly kind: string;
  readonly detail: string;
}

export interface EditOutcome {
  /** true = modifica applicata senza regressioni. */
  readonly accepted: boolean;
  /** Accettata: HTML nuovo. Rifiutata: HTML attuale invariato. */
  readonly html: string;
  readonly report: QaReport;
  /** Se rifiutata: i criteri che la modifica romperebbe, con dettaglio. */
  readonly conflicts: readonly EditConflict[];
}

export async function applyChange(args: {
  readonly spec: ProjectSpec;
  readonly currentHtml: string;
  readonly instruction: string;
  readonly llm: LLMProvider;
  readonly runQa: (html: string) => Promise<Result<QaReport>>;
}): Promise<Result<EditOutcome>> {
  const system =
    'Sei un editor di siti web. Ricevi un HTML completo e UNA richiesta di modifica in linguaggio naturale. ' +
    'Applica SOLO la modifica richiesta, lasciando invariato tutto il resto (testi, sezioni, struttura, comportamento del form). ' +
    'Mantieni UNA sola pagina scrollabile, CSS e JS inline, nessuna risorsa esterna. ' +
    "Rispondi SOLO con l'HTML completo aggiornato: nessuna spiegazione, nessun blocco markdown.";
  const prompt = `HTML attuale:\n${args.currentHtml}\n\nModifica richiesta:\n${args.instruction}`;

  const res = await args.llm.complete({ system, prompt, tier: 'balanced', maxTokens: 8192 });
  if (!res.ok) return err(res.error);
  const next = extractHtml(res.value.text);
  if (!next) return err(appError('EDIT_EMPTY', 'La modifica non ha prodotto HTML valido.', { retryable: true }));

  const qa = await args.runQa(next);
  if (!qa.ok) return err(qa.error);
  const report = qa.value;

  if (report.buildSucceeded) {
    return ok({ accepted: true, html: next, report, conflicts: [] });
  }

  const conflicts: EditConflict[] = [...report.level1, ...report.level2]
    .filter((r) => !r.passed)
    .map((r) => ({ criterionId: r.criterionId, kind: r.kind, detail: r.detail ?? 'check fallito' }));
  return ok({ accepted: false, html: args.currentHtml, report, conflicts });
}
