/**
 * Intake: domande di chiarimento PRIMA di costruire.
 *
 * Dalla descrizione iniziale, l'LLM capisce il TIPO di attivita e cosa e gia noto,
 * poi genera domande MIRATE e SPECIFICHE per raccogliere i contenuti reali: piu
 * informazioni ora => meno correzioni dopo e meno cose inventate dal generatore.
 * Numero adattivo (di solito 5-8). Le risposte vengono ripiegate nella descrizione
 * passata a createProject: nessuna modifica al motore, e il pianificatore a integrarle.
 *
 * Tier "balanced": domande personalizzate richiedono un modello capace.
 */
import { type LLMProvider, type Result, ok, err } from '@core';
import { recommendedThemeFromDescription } from './industryEngine.js';

export interface IntakeQuestion {
  readonly question: string;
  readonly options?: readonly string[];
}

const SYSTEM = [
  'Aiuti una persona NON tecnica a chiarire il sito vetrina che vuole, PRIMA di costruirlo.',
  'Obiettivo: raccogliere i CONTENUTI reali della sua attivita, cosi che il sito non sia inventato. Piu informazioni raccogli ora, meno correzioni servono dopo.',
  'Dalla descrizione, capisci di che TIPO di attivita si tratta e cosa e gia noto. Poi genera domande MIRATE e SPECIFICHE per quella attivita: riusa le sue parole e NON chiedere cio che ha gia detto.',
  'Numero adattivo: fai quante domande servono per non dover inventare nulla. Di solito 5-8. Meno (anche zero) solo se la descrizione e gia molto completa; di piu se e scarna.',
  'Copri, quando pertinente al caso specifico: nome esatto dell attivita; una frase che la descrive (claim); prodotti/servizi principali con 3-4 esempi concreti (ed eventuali prezzi); cosa la rende diversa; cliente tipo; tono/stile desiderato; citta o zona servita; contatti da mostrare (telefono, WhatsApp, indirizzo, orari); profili social; prove (anni di attivita, premi, recensioni); azione principale che il visitatore deve compiere (chiamare, prenotare, venire, ordinare).',
  'Adatta le domande al settore. Esempi: ristorante/bar -> piatti o specialita in evidenza, tipo di cucina, prenotazioni; professionista/freelance -> servizi, esperienza e credenziali, come lavora; negozio -> categorie di prodotti, vendita online o in sede; palestra/benessere -> corsi, orari, prova gratuita; artigiano -> lavorazioni, zona, tempi.',
  'VIDEO: se l attivita MOSTRA o PRODUCE video (videomaker, regista, filmmaker, fotografo con reel, casa di produzione, content creator, musicista), AGGIUNGI una domanda a TESTO LIBERO (senza opzioni) in cui chiedi di incollare i link YouTube dei video da mostrare, UNO PER RIGA, precisando che puo lasciare vuoto se non li ha ancora pronti. Non inventare i link.',
  'Ogni domanda: breve, concreta, riferita alla SUA attivita. Quando ha senso proponi 2-4 opzioni rapide e concrete (la persona potra comunque scrivere una risposta libera).',
  'NON chiedere dettagli tecnici (hosting, dominio, codice, email di recapito): quelli si impostano altrove.',
  'Inoltre scegli lo STILE visivo piu adatto all attivita, tra questi temi (usa ESATTAMENTE questi id):',
  '- editorial-luxury: lusso editoriale ed eleganza (hotel e ristoranti raffinati, moda, beauty, gioielli).',
  '- athletic-premium: energia e movimento (palestre, fitness, sport, performance, wellness attivo).',
    '- scandinavian-service: pulito e professionale (professionisti, servizi locali, consulenti).',
    '- warm-bistro: caldo e food-first (pizzerie, trattorie, bar, panifici, pasticcerie, food casual).',
  '- modern-saas: software e digitale (app, piattaforme, startup tech, gestionali, prodotti SaaS).',
  '- creative-studio: creativi e portfolio (agenzie, designer, fotografi, videomaker, brand).',
  '- future-minimal: minimale e tecnologico (AI, prodotti innovativi, tech d avanguardia).',
  '- modern-community: caldo e umano (community, membership, club, coworking, creator, academy).',
  '- industrial-bold: forte e materico (industria, manifattura, edilizia, logistica, automotive, energia).',
  'Scegli SEMPRE il piu vicino anche se nessuno calza perfettamente: recommendedStyle non deve mai restare vuoto.',
  'Rispondi SOLO con JSON valido (nessun markdown):',
  '{"recommendedStyle":"editorial-luxury","questions":[{"question":"Quali 3-4 piatti volete mettere in evidenza?","options":["Li scrivo io","Solo le categorie (antipasti, primi...)","Decidete voi"]},{"question":"Su quale zona volete attirare clienti?"}]}',
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
}): Promise<Result<{ questions: IntakeQuestion[]; recommendedStyle: string | null }>> {
  const res = await args.llm.complete({
    system: SYSTEM,
    prompt: 'Descrizione del sito:\n' + args.description,
    tier: 'balanced',
    maxTokens: 1800,
  });
  if (!res.ok) return err(res.error);

  const out: IntakeQuestion[] = [];
  try {
    const p = JSON.parse(stripToJson(res.value.text)) as { questions?: unknown };
    const arr = Array.isArray(p.questions) ? p.questions : [];
    for (const q of arr.slice(0, 8)) {
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

  // Lo STILE proposto NON e lasciato all'LLM (spingeva tutto su editorial-luxury):
  // e deterministico e riusa la stessa logica keyword del livello decisionale, cosi la
  // proposta dell'intake coincide col tema che il generatore userebbe. L'LLM resta solo
  // per le domande. Eventuale recommendedStyle nel JSON dell'LLM viene ignorato.
  const recommendedStyle = recommendedThemeFromDescription(args.description);
  console.log('  → intake_recommended_style: ' + recommendedStyle + ' [source: deterministic] · intake_description_excerpt: ' + JSON.stringify(args.description.slice(0, 80)));
  return ok({ questions: out, recommendedStyle });
}
