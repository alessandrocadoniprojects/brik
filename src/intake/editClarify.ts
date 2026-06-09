/**
 * Pre-modifica: domande di chiarimento PRIMA di applicare una modifica.
 *
 * Una modifica costa (rigenero del sito + QA nel browser reale). Se l'istruzione
 * e ambigua — tipico per "aggiungi X" senza dire DOVE o con quali dettagli — un
 * modello veloce (tier "fast") genera 1-2 domande mirate, mostrate con la stessa
 * UI dell'intake. Le risposte vengono accodate all'istruzione: nessun cambiamento
 * al motore di modifica. Se l'istruzione e gia chiara, nessuna domanda (zero attriti).
 */
import { type ProjectSpec, type LLMProvider, type Result, ok, err } from '@core';
import type { RouteInfo } from '../adapters/anthropic/siteGenerator.js';
import type { IntakeQuestion } from './intakeQuestions.js';

const SYSTEM = [
  'Valuti se una richiesta di MODIFICA a un sito gia esistente e abbastanza chiara per essere eseguita SUBITO, senza ambiguita.',
  'Hai: il titolo del sito, l elenco delle pagine (route + nome) e i requisiti attuali. Hai anche l istruzione dell utente.',
  'Se l istruzione e chiara (si capisce COSA fare e, se serve, DOVE), NON fare domande: rispondi {"questions":[]}.',
  'Fai domande SOLO se manca un dettaglio che ti impedirebbe di eseguire bene la modifica. Casi tipici: "aggiungi X" senza dire su quale pagina o sezione; oppure mancano i dati necessari (es. "aggiungi una mappa" -> quale indirizzo?; "aggiungi i prezzi" -> quali?; "aggiungi una sezione" -> con quali contenuti?).',
  'Massimo 2 domande, brevissime e riferite a QUESTO sito. Per il "dove" proponi come opzioni le pagine reali (usa i loro nomi). Per i dettagli, lascia risposta libera oppure proponi 2-4 opzioni concrete quando ha senso.',
  'NON chiedere cose ovvie o gia deducibili dall istruzione, ne dettagli tecnici (hosting, dominio, codice). Nel dubbio tra fare una domanda banale e non farla, NON farla.',
  'Rispondi SOLO con JSON valido (nessun markdown):',
  '{"questions":[{"question":"In quale pagina aggiungo la mappa?","options":["Home","Contatti"]},{"question":"Qual e l indirizzo esatto da mostrare?"}]}',
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

export async function planEditClarification(args: {
  readonly instruction: string;
  readonly spec: ProjectSpec;
  readonly routes: readonly RouteInfo[];
  readonly llm: LLMProvider;
}): Promise<Result<IntakeQuestion[]>> {
  const pages = args.routes.map((r) => `${r.route} (${r.label})`).join(', ') || '/';
  const reqs = args.spec.criteria.map((c, i) => `[${i + 1}] ${c.statement}`).join('\n');
  const prompt = [
    'Titolo sito: ' + (args.spec.title || '(senza titolo)'),
    'Pagine: ' + pages,
    'Requisiti attuali:',
    reqs || '(nessuno)',
    '',
    'Istruzione di modifica dell utente:',
    args.instruction,
  ].join('\n');

  const res = await args.llm.complete({ system: SYSTEM, prompt, tier: 'fast', maxTokens: 600 });
  if (!res.ok) return err(res.error);

  const out: IntakeQuestion[] = [];
  try {
    const p = JSON.parse(stripToJson(res.value.text)) as { questions?: unknown };
    const arr = Array.isArray(p.questions) ? p.questions : [];
    for (const q of arr.slice(0, 2)) {
      if (!q || typeof q !== 'object') continue;
      const obj = q as Record<string, unknown>;
      const question = typeof obj.question === 'string' ? obj.question.trim() : '';
      if (!question) continue;
      const rawOpts = Array.isArray(obj.options) ? obj.options : [];
      const options = rawOpts.map((o) => String(o).trim()).filter((o) => o.length > 0).slice(0, 4);
      out.push(options.length ? { question, options } : { question });
    }
  } catch {
    // istruzione gia chiara o output non interpretabile: nessuna domanda
  }
  return ok(out);
}
