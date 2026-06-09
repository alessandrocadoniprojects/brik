/**
 * Revisione del "direttore creativo": un cancello di QUALITÀ percepita, distinto
 * dalla QA funzionale. Giudica la HOME generata come farebbe il direttore di uno
 * studio premium ("varrebbe 20.000 €?") e, se è sotto soglia, restituisce problemi
 * concreti che guidano UNA rigenerazione mirata.
 *
 * Step 5: il giudizio passa da UN voto singolo a una RUBRICA multi-asse (8 assi)
 * più un voto complessivo e una decisione (pass | revise | regenerate). Gli assi
 * servono a rendere il giudizio più affidabile, NON a creare loop complessi: il
 * gate a valle resta identico (al massimo UNA rigenerazione). I campi storici
 * `pass`, `score` e `issues` restano invariati, così `siteSession` non cambia logica.
 *
 * Giudica ciò che è ispezionabile nel codice: gerarchia, ritmo, densità, qualità
 * del copy, odore-da-template. NON giudica i pixel (servirebbe uno screenshot +
 * modello con visione: è un passo futuro, più pesante).
 *
 * È BEST-EFFORT: qualunque errore (LLM giù, JSON sporco) restituisce "promosso",
 * così la creazione non viene mai bloccata dal revisore.
 */
import { type LLMProvider } from '@core';

/** Gli 8 assi della rubrica, ciascuno 0..10. */
export interface DirectorScores {
  readonly prestige: number;
  readonly industry_fit: number;
  readonly visual_hierarchy: number;
  readonly restraint: number;
  readonly conversion_clarity: number;
  readonly anti_cliche: number;
  readonly copy_quality: number;
  readonly theme_alignment: number;
}

/** Decisione finale del direttore. */
export type DirectorDecision = 'pass' | 'revise' | 'regenerate';

export interface DirectorVerdict {
  readonly pass: boolean; // usato dal gate: true = tieni, false = (con issues) rigenera una volta
  readonly score: number; // voto COMPLESSIVO 0..10 (= overall), retrocompatibile
  readonly decision: DirectorDecision;
  readonly scores: DirectorScores | null; // breakdown per-asse; null se non disponibile
  readonly issues: readonly string[];
}

const AXES: readonly (keyof DirectorScores)[] = [
  'prestige',
  'industry_fit',
  'visual_hierarchy',
  'restraint',
  'conversion_clarity',
  'anti_cliche',
  'copy_quality',
  'theme_alignment',
];

const SYSTEM = [
  'Sei il direttore creativo di uno studio di design premium. Giudichi UNA home page (ricevi il suo HTML) come se il cliente avesse pagato tra 20.000 e 50.000 € per il sito.',
  'Giudichi SOLO ciò che è visibile nella struttura e nei testi: gerarchia, ritmo, densità, qualità del copy, "odore da template". NON giudichi i pixel né le immagini (sono segnaposto).',
  // Rubrica: ogni asse 0-10. Descrizioni tenute brevi per non allungare il prompt.
  'Dai un voto 0-10 a OGNI asse:',
  '- prestige: percezione di valore e cura, livello "studio premium".',
  '- industry_fit: aderenza al settore e al suo tono giusto.',
  '- visual_hierarchy: gerarchia chiara e ritmo delle sezioni.',
  '- restraint: sobrietà e densità BASSA (obiettivo 3/10), molta aria.',
  '- conversion_clarity: azione chiara, CTA al punto giusto e non ripetuta ovunque.',
  '- anti_cliche: assenza di cliché, aria da template o da AI generico.',
  '- copy_quality: copy concreto e specifico, niente frasi vuote ("soluzioni innovative", "il tuo partner ideale").',
  '- theme_alignment: coerenza con UNA sola identità visiva forte.',
  'Poi dai "overall" 0-10 (giudizio complessivo, NON media meccanica) e "decision":',
  '- "pass" se è davvero di livello; "revise" se è buono ma migliorabile; "regenerate" se sa di template o è sotto livello.',
  'Sii severo: un sito "ok da template" NON merita "pass".',
  'Rispondi SOLO con JSON, senza markdown e senza altro testo: {"scores":{"prestige":n,"industry_fit":n,"visual_hierarchy":n,"restraint":n,"conversion_clarity":n,"anti_cliche":n,"copy_quality":n,"theme_alignment":n},"overall":n,"decision":"pass|revise|regenerate","issues":["correzione concreta e azionabile", ...]}. Le issues: al massimo 5, brevi, imperative, specifiche a QUESTA home (non principi generici).',
].join('\n');

/** Estrae il primo oggetto JSON da una risposta eventualmente "sporca". */
function stripToJson(s: string): string {
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}

/** Numero valido in 0..10, altrimenti il fallback. */
function clamp10(x: unknown, fallback: number): number {
  if (typeof x !== 'number' || !isFinite(x)) return fallback;
  return Math.max(0, Math.min(10, x));
}

/** Verdetto "promosso" di sicurezza (best-effort: non blocca mai la creazione). */
function passFallback(): DirectorVerdict {
  return { pass: true, score: 10, decision: 'pass', scores: null, issues: [] };
}

export async function reviewSite(args: {
  readonly llm: LLMProvider;
  readonly business: string;
  readonly homeHtml: string;
  /** Soglia di promozione sul voto complessivo (default 7). */
  readonly minScore?: number;
  /** Sintesi compatta dei findings del detector deterministico (opzionale, consultiva). */
  readonly designFindings?: readonly string[];
}): Promise<DirectorVerdict> {
  const min = typeof args.minScore === 'number' ? args.minScore : 7;
  // Basta la home, e troncata: contiene i token e la home porta il giudizio "in 3 secondi".
  const html = (args.homeHtml || '').slice(0, 18000);
  if (!html.trim()) return passFallback();

  // I findings del detector sono CONTESTO, non verdetto: ancorano il giudizio del
  // modello a fatti concreti, ma il punteggio resta del revisore.
  const findingsBlock =
    args.designFindings && args.designFindings.length
      ? '\n\nUn controllo deterministico ha già rilevato (considerali, ma giudica tu):\n' + args.designFindings.slice(0, 5).map((s) => '- ' + s).join('\n')
      : '';

  const prompt = [
    'Attività: ' + (args.business || '').slice(0, 500),
    findingsBlock,
    '',
    'HOME (HTML da giudicare):',
    html,
  ].join('\n');

  try {
    // maxTokens leggermente più alto del passato: 8 voti + overall + decision + issues.
    const res = await args.llm.complete({ system: SYSTEM, prompt, tier: 'balanced', maxTokens: 700 });
    if (!res.ok) return passFallback();
    const parsed = JSON.parse(stripToJson(res.value.text)) as {
      scores?: Record<string, unknown>;
      overall?: unknown;
      decision?: unknown;
      issues?: unknown;
    };

    // Breakdown per-asse: ogni asse mancante eredita una sufficienza prudente (overall o min).
    const rawScores = parsed.scores && typeof parsed.scores === 'object' ? parsed.scores : {};
    const overallRaw = clamp10(parsed.overall, NaN as unknown as number);
    const seed = isFinite(overallRaw) ? overallRaw : min;
    const scores: DirectorScores = {
      prestige: clamp10(rawScores['prestige'], seed),
      industry_fit: clamp10(rawScores['industry_fit'], seed),
      visual_hierarchy: clamp10(rawScores['visual_hierarchy'], seed),
      restraint: clamp10(rawScores['restraint'], seed),
      conversion_clarity: clamp10(rawScores['conversion_clarity'], seed),
      anti_cliche: clamp10(rawScores['anti_cliche'], seed),
      copy_quality: clamp10(rawScores['copy_quality'], seed),
      theme_alignment: clamp10(rawScores['theme_alignment'], seed),
    };

    // overall: se assente, media degli assi (giudizio comunque sensato).
    const mean = AXES.reduce((n, k) => n + scores[k], 0) / AXES.length;
    const overall = isFinite(overallRaw) ? overallRaw : Math.round(mean * 10) / 10;

    // decision: rispetta quella del modello se valida, altrimenti derivala dalla soglia.
    const d = parsed.decision;
    const decision: DirectorDecision =
      d === 'pass' || d === 'revise' || d === 'regenerate' ? d : overall >= min ? 'pass' : 'regenerate';

    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 5)
      : [];

    // Gate (invariato come effetto: una sola rigenerazione a valle):
    // - 'regenerate' non passa MAI;
    // - 'pass' passa;
    // - 'revise' passa solo se il complessivo raggiunge la soglia.
    const pass = decision === 'pass' || (decision !== 'regenerate' && overall >= min);

    return { pass, score: overall, decision, scores, issues };
  } catch {
    return passFallback();
  }
}
