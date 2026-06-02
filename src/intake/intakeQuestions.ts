/**
 * Intake: domande di chiarimento PRIMA di costruire.
 *
 * Dalla descrizione iniziale, l'LLM individua al massimo 3 punti mancanti che
 * cambiano davvero il risultato (pagine, modulo di contatto e campi, stile,
 * contenuti chiave). Le risposte vengono poi ripiegate nella descrizione passata
 * a createProject: nessuna modifica al motore: e il pianificatore a integrarle.
 *
 * Tier "fast" (Haiku): poche domande brevi non richiedono il modello grande.
 */
import { type LLMProvider, type Result, ok, err } from '@core';

export interface IntakeQuestion {
  readonly question: string;
  readonly options?: readonly string[];
}

const SYSTEM = [
  'Aiuti una persona NON tecnica a chiarire il sito che vuole, prima di costruirlo.',
  'Data la sua descrizione, genera AL MASSIMO 3 domande brevi, concrete e NON ridondanti: chiedi solo cio che manca e che cambia davvero il risultato (es. quali/quante pagine, se vuole un modulo di contatto e con quali campi, lo stile/tono, contenuti chiave non ancora indicati).',
  'NON chiedere cose gia presenti nella descrizione. NON chiedere dettagli tecnici (hosting, dominio, codice, email di recapito).',
  'Per ogni domanda, quando ha senso, proponi 2-4 opzioni rapide e concrete (la persona potra comunque scrivere una risposta libera).',
  'Se la descrizione e gia sufficiente per costruire, restituisci una lista vuota.',
  'Rispondi SOLO con JSON valido (nessun markdown):',
  '{"questions":[{"question":"Vuoi un modulo di contatto?","options":["Si, nome/email/messaggio","Si, con telefono","No"]}]}',
].join('\n');

function stripToJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a !== -1 && b > a) s = s.slice(a, b + 1);
  return s;
}

export async function planIntakeQuestions(args: {
  readonly description: string;
  readonly llm: LLMProvider;
}): Promise<Result<IntakeQuestion[]>> {
  const res = await args.llm.complete({
    system: SYSTEM,
    prompt: 'Descrizione del sito:\n' + args.description,
    tier: 'fast',
    maxTokens: 700,
  });
  if (!res.ok) return err(res.error);

  const out: IntakeQuestion[] = [];
  try {
    const p = JSON.parse(stripToJson(res.value.text)) as { questions?: unknown };
    const arr = Array.isArray(p.questions) ? p.questions : [];
    for (const q of arr.slice(0, 3)) {
      if (!q || typeof q !== 'object') continue;
      const obj = q as Record<string, unknown>;
      const question = typeof obj.question === 'string' ? obj.question.trim() : '';
      if (!question) continue;
      const rawOpts = Array.isArray(obj.options) ? obj.options : [];
      const options = rawOpts.map((o) => String(o).trim()).filter((o) => o.length > 0).slice(0, 4);
      out.push(options.length ? { question, options } : { question });
    }
  } catch {
    // descrizione gia sufficiente o output non interpretabile: nessuna domanda
  }
  return ok(out);
}
