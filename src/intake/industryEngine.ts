/**
 * Industry Engine + Pattern Database (Creative Director System — Step 1).
 *
 * MODULO NUOVO E SCOLLEGATO: in questo step NESSUN file di runtime lo importa.
 * Non tocca la generazione, il design system, le identità, motion o il generatore
 * HTML. Serve a produrre — in modo deterministico, testabile e loggabile — un
 * oggetto `CreativeDirection` a partire da una descrizione d'attività o da un
 * settore forzato. L'aggancio al planner/generatore avverrà negli step successivi.
 *
 * Mappatura settore → identità fornita dall'utente (visualDNA / prestige / pattern):
 *   restaurant: Hospitality / Luxury Experience / Atmosphere First
 *   dentist:    Premium Medical / Calm Medical Trust / Transformation Without Noise
 *   law_firm:   Corporate Luxury / Professional Inevitability / Editorial Authority
 */
import type {
  Industry,
  IndustrySeed,
  CompositionPattern,
  PatternKey,
  CreativeDirection,
  RecommendedTheme,
} from '../core/creativeDirection.js';

/**
 * PATTERN DATABASE
 * Ogni pattern dominante diventa poche direttive compositive concrete. Restano
 * brevi e selettive: in step successivi confluiranno nel prompt, e troppe
 * direttive insieme peggiorerebbero l'aderenza del modello.
 */
export const PATTERN_DB: Record<Exclude<PatternKey, 'none'>, CompositionPattern> = {
  'atmosphere-first': {
    key: 'atmosphere-first',
    label: 'Atmosphere First',
    directives: [
      'Apri con atmosfera, non con il menu o i prezzi: una scena evocativa prima di qualsiasi elenco.',
      'Crea desiderio prima di informare: luce, materia e dettaglio sensoriale nella hero.',
      'Una sola immagine dominante e molto respiro; evita griglie di piatti in stile catalogo.',
    ],
  },
  'calm-medical-trust': {
    key: 'calm-medical-trust',
    label: 'Calm Medical Trust',
    directives: [
      'Tono calmo e rassicurante: spazi ampi, palette chiara, nessun elemento ansiogeno.',
      'Metti la prova (recensioni, credenziali, foto reali dello studio) prima della richiesta di prenotazione.',
      'Niente immagini cliniche crude; trasmetti sicurezza e pulizia, non tecnicismo.',
    ],
  },
  'transformation-without-noise': {
    key: 'transformation-without-noise',
    label: 'Transformation Without Noise',
    directives: [
      'Mostra il risultato/la trasformazione con sobrietà: prima/dopo discreto, mai urlato.',
      'Eleganza e pulizia al posto dell\'enfasi: poche parole, molta fiducia.',
      'La CTA arriva dopo che la rassicurazione è stata costruita, non subito.',
    ],
  },
  'professional-inevitability': {
    key: 'professional-inevitability',
    label: 'Professional Inevitability',
    directives: [
      'Precisione e autorità: gerarchia tipografica forte, ritmo asciutto, nessun fronzolo.',
      'Metti casi, risultati e competenze (la prova) prima delle promesse.',
      'Tono inevitabile e misurato: il sito deve sembrare preciso prima ancora di parlare.',
    ],
  },
  'editorial-authority': {
    key: 'editorial-authority',
    label: 'Editorial Authority',
    directives: [
      'Impaginazione editoriale: titoli ampi, ritmo da rivista, una sola firma forte.',
      'Autorevolezza attraverso la composizione, non attraverso il volume.',
      'Molta aria e una sola idea dominante per schermata.',
    ],
  },
  'creative-portfolio-authority': {
    key: 'creative-portfolio-authority',
    label: 'Creative Portfolio Authority',
    directives: [
      'Apri con un PUNTO DI VISTA, non con un claim generico: una posizione, non uno slogan.',
      'I lavori selezionati sono la prova principale: mostrali presto e con respiro, mai in fondo.',
      'Metodo e pensiero progettuale come trust signal, al posto di numeri o testimonianze.',
      'Tipografia e composizione sono SOSTANZA, non decorazione: gusto, precisione, cultura visiva.',
      'Evita la struttura da builder (hero, servizi, numeri, testimonianze, CTA) e i numeri finti.',
    ],
  },
  'advisory-method-trust': {
    key: 'advisory-method-trust',
    label: 'Advisory Method Trust',
    directives: [
      'Apri stabilendo METODO e GIUDIZIO, non con un claim: mostra come pensi, non cosa vendi.',
      'Casi concreti e decisioni difficili sono la prova principale, PRIMA delle promesse.',
      'Rendi esplicita l\'esperienza locale e settoriale: il contesto in cui operi e un asset, mostralo.',
      'Mostra continuita e relazioni durature nel tempo, incluso il passaggio generazionale, non progetti spot.',
      'Autorevolezza per sobrieta e gerarchia tipografica, mai per volume o numeri gonfiati.',
    ],
  },
};

/**
 * INDUSTRY SEEDS
 * La "DNA" decisionale per settore. `recommendedTheme` sceglie tra le 8 identità
 * ESISTENTI (non ne crea di nuove) e resta una raccomandazione sovrascrivibile.
 * `ctaSeed` è un suggerimento di CTA per il SITO (lo "Generate ... Website" del
 * documento di sprint era il bottone della sua UI, non una CTA di sito).
 */
export const INDUSTRY_SEEDS: Record<Industry, IndustrySeed> = {
  restaurant: {
    industry: 'restaurant',
    primaryEmotion: 'Desire',
    prestigeProfile: 'Luxury Experience',
    visualDNA: 'Hospitality',
    dominantPattern: 'atmosphere-first',
    recommendedTheme: 'editorial-luxury', // scuro, atmosferico, hero editoriale: aderente a "Atmosphere First"
    recommendedVariant: 'dark',
    headlineSeed: 'Un sito per un ristorante deve creare appetito prima di mostrare il menu.',
    ctaSeed: 'Prenota un tavolo',
    antiCliches: ['delivery-first', 'menu in PDF', 'foto stock di cibo'],
    directionHints: ['atmosfera prima del menu', 'desiderio prima della prenotazione', 'immagini calde e cinematiche'],
  },
  dentist: {
    industry: 'dentist',
    primaryEmotion: 'Reassurance',
    prestigeProfile: 'Calm Medical Trust',
    visualDNA: 'Premium Medical',
    dominantPattern: 'transformation-without-noise',
    recommendedTheme: 'scandinavian-service', // calmo, pulito, chiaro: il tema "medical calm" del documento
    recommendedVariant: 'light',
    headlineSeed: 'Un sito per uno studio dentistico deve far sentire i pazienti al sicuro prima che prenotino.',
    ctaSeed: 'Prenota una visita',
    antiCliches: ['immagini cliniche crude', 'toni urlati o promozionali', 'stock di camici e denti'],
    directionHints: ['rassicurazione prima della prenotazione', 'spazi ampi e palette chiara', 'prova e credenziali in evidenza'],
    photoSubjects: [
      'dettagli di strumenti clinici puliti',
      'ambienti dello studio luminosi e ordinati',
      'mani del medico al lavoro (primo piano)',
      'poltrona odontoiatrica in luce naturale',
      'reception minimale ed elegante',
      'primi piani astratti e professionali (texture, materiali, luce)',
    ],
    photoAvoid: [
      'persone che scrivono su agende o computer',
      'corridoi ospedalieri freddi o asettici',
      'immagini beauty o fashion',
      'foto stock troppo generiche di persone che sorridono',
    ],
    narrative:
      'paura del dentista, poi ascolto, poi chiarezza, poi cura precisa, poi continuita nel tempo: la home apre disinnescando la paura e ogni sezione successiva e il passo dopo di questo arco.',
    voice:
      'calmo, rassicurante, specifico e umano; mai commerciale; i testi dei servizi spiegano con chiarezza cosa si prova e cosa succede, non elencano tecnicismi.',
  },
  law_firm: {
    industry: 'law_firm',
    primaryEmotion: 'Trust',
    prestigeProfile: 'Professional Inevitability',
    visualDNA: 'Corporate Luxury',
    dominantPattern: 'editorial-authority',
    recommendedTheme: 'editorial-luxury', // "Editorial Authority" mappa qui; alternativa valida: industrial-bold
    headlineSeed: 'Un sito per uno studio legale deve trasmettere precisione prima ancora di dire una parola.',
    ctaSeed: 'Richiedi una consulenza',
    antiCliches: ['stock di martelletti e bilance', 'gergo legale fitto', 'griglie di servizi generiche'],
    directionHints: ['precisione prima delle promesse', 'gerarchia tipografica forte', 'casi e risultati come prova'],
  },
  creative_agency: {
    industry: 'creative_agency',
    primaryEmotion: 'Creative Authority',
    prestigeProfile: 'Studio Premium Editoriale',
    visualDNA: 'Editoriale, bold, tipografico',
    dominantPattern: 'creative-portfolio-authority',
    recommendedTheme: 'creative-studio', // casa naturale per bold creative / editoriale / tipografico
    headlineSeed: 'Una agenzia creativa si giudica dal lavoro: mostra un punto di vista e opere selezionate, non slogan.',
    ctaSeed: 'Parliamo del progetto',
    antiCliches: ['numeri o statistiche finte', 'emoji', 'frasi come soluzioni creative o partner ideale', 'struttura SaaS a card e icone'],
    directionHints: [
      'apri con un punto di vista e opere selezionate, non con un hero generico',
      'usa metodo e pensiero progettuale come prova, non numeri o testimonianze',
      'sezioni utili: hero statement, selected works, services, method, about, contact',
    ],
    photoSubjects: [
      'dettagli editoriali e tipografici',
      'mockup e identita visive',
      'lavori di portfolio selezionati',
      'lo studio e il processo di lavoro',
      'texture e materiali di stampa',
    ],
    photoAvoid: [
      'persone in posa che sorridono',
      'stock business generico',
      'foto lifestyle non pertinenti',
    ],
    narrative:
      'punto di vista prima, opere selezionate come prova, poi metodo, servizi e contatto: autorevolezza per composizione, non per volume.',
    voice:
      'identita che durano, forma e strategia insieme, sistemi visivi non decorazione; tono autorevole e asciutto, mai frasi come soluzioni creative.',
  },
  consulting_advisory: {
    industry: 'consulting_advisory',
    primaryEmotion: 'Considered Authority',
    prestigeProfile: 'Trusted Advisor, autorita silenziosa',
    visualDNA: 'Sobrio, chiaro, metodico',
    dominantPattern: 'advisory-method-trust',
    recommendedTheme: 'scandinavian-service', // chiarezza, metodo, sobrieta: autorevolezza senza ostentazione
    headlineSeed: 'Una consulenza seria si giudica dal metodo e dai casi, non dai claim: mostra come pensi e quali decisioni hai accompagnato.',
    ctaSeed: 'Richiedi un primo confronto',
    antiCliches: [
      'frasi vuote come soluzioni su misura o partner per la crescita',
      'claim senza prova e numeri inventati',
      'griglie di card SaaS e tono da startup',
      'foto business generiche, handshake e meeting in posa',
    ],
    directionHints: [
      'apri con metodo e giudizio, non con un claim',
      'casi concreti e decisioni difficili come prova, prima delle promesse',
      'rendi esplicita esperienza locale e settoriale e la continuita nel tempo',
    ],
    photoSubjects: [
      'ritratti sobri e reali del consulente o del team',
      'dettagli di metodo: appunti, schemi, lavagne, documenti',
      'ambienti di lavoro reali e ordinati',
      'il territorio e il contesto locale in cui opera lo studio',
      'dettagli editoriali e materici premium',
    ],
    photoAvoid: [
      'persone in meeting in posa che sorridono',
      'strette di mano (handshake) stock',
      'foto corporate o business stock generiche',
      'grattacieli e vetrate da brochure',
      'gente al laptop sorridente',
    ],
    narrative:
      'fiducia prima della vendita, poi metodo e giudizio, poi casi e decisioni difficili come prova, poi esperienza locale e settoriale, poi continuita nel tempo: ogni sezione costruisce autorevolezza senza ostentazione.',
    voice:
      'sobrio, autorevole e concreto, mai da startup o marketing; parla di decisioni, metodo e casi, non di soluzioni; specifico al settore e al territorio.',
  },
  // Fallback sicuro: nessuna direzione forte, nessun tema forzato → resta la
  // scelta automatica/utente del generatore esistente.
  generic: {
    industry: 'generic',
    primaryEmotion: '',
    prestigeProfile: '',
    visualDNA: '',
    dominantPattern: 'none',
    headlineSeed: '',
    ctaSeed: '',
    antiCliches: [],
    directionHints: [],
  },
};

/**
 * Rilevatore di settore best-effort, deterministico e trasparente (sole parole
 * chiave, niente rete). Restituisce sempre un valore valido: `generic` se nulla
 * combacia. In step successivi potrà essere affiancato/sostituito dal classifier LLM.
 */
export function detectIndustry(description: string): Industry {
  const t = (description || '').toLowerCase();
  const has = (...kw: string[]) => kw.some((k) => t.includes(k));
  if (has('ristorant', 'trattoria', 'osteria', 'pizzeria', 'bistrot', 'menu', 'cucina', 'chef', 'restaurant')) return 'restaurant';
  if (has('dentist', 'odontoiatr', 'dental', 'ortodonzia', 'igiene dentale', 'impianti dentali')) return 'dentist';
  if (has('avvocat', 'studio legale', 'notaio', 'law firm', 'attorney', 'contenzioso')) return 'law_firm';
  if (has('agenzia creativa', 'creative agency', 'studio creativo', 'studio branding', 'brand identity', 'identita visiva', 'identità visiva', 'art direction', 'direzione artistica', 'design studio', 'studio grafico', 'portfolio creativo', 'comunicazione visiva', 'visual identity', 'siti per brand premium', 'branding')) return 'creative_agency';
  if (has('studio di consulenza', 'consulenza strategica', 'business advisory', 'advisory', 'consulente aziendale', 'consulenza direzionale', 'consulenza operativa', "strategia d'impresa", 'strategia di impresa', 'crescita aziendale', 'riorganizzazione aziendale', 'passaggio generazionale', 'management consulting')) return 'consulting_advisory';
  return 'generic';
}

/**
 * Compone la CreativeDirection per un settore dato: unisce il seed con le
 * direttive del pattern dominante risolte dal Pattern Database.
 * Gli optional sono spread condizionalmente per rispettare exactOptionalPropertyTypes.
 */
export function creativeDirectionForIndustry(
  industry: Industry,
  opts?: { detected?: boolean },
): CreativeDirection {
  const seed = INDUSTRY_SEEDS[industry] ?? INDUSTRY_SEEDS.generic;
  const pattern = seed.dominantPattern !== 'none' ? PATTERN_DB[seed.dominantPattern] : undefined;
  return {
    industry: seed.industry,
    detected: opts?.detected ?? seed.industry !== 'generic',
    primaryEmotion: seed.primaryEmotion,
    prestigeProfile: seed.prestigeProfile,
    visualDNA: seed.visualDNA,
    dominantPattern: seed.dominantPattern,
    ...(seed.recommendedTheme ? { recommendedTheme: seed.recommendedTheme } : {}),
    ...(seed.recommendedVariant ? { recommendedVariant: seed.recommendedVariant } : {}),
    headlineSeed: seed.headlineSeed,
    ctaSeed: seed.ctaSeed,
    antiCliches: seed.antiCliches,
    directionHints: seed.directionHints,
    ...(seed.photoSubjects ? { photoSubjects: seed.photoSubjects } : {}),
    ...(seed.photoAvoid ? { photoAvoid: seed.photoAvoid } : {}),
    ...(seed.narrative ? { narrative: seed.narrative } : {}),
    ...(seed.voice ? { voice: seed.voice } : {}),
    directives: pattern ? pattern.directives : [],
  };
}

/**
 * Decide il TEMA (uno degli 8 esistenti) dalla descrizione, con keyword conservative
 * e fallback sicuro a 'scandinavian-service'. NON introduce nuovi temi. È volutamente
 * a livello di descrizione (non di settore): consente biforcazioni come pizzeria →
 * scandinavian vs ristorante gourmet → editorial-luxury, copre categorie fuori
 * dall'enum Industry e non ricade MAI sul noir di default per il non riconosciuto.
 * Valutazione first-match: l'ordine conta (specifico prima del generico).
 */
export function recommendedThemeFromDescription(description: string): RecommendedTheme {
  const t = (description || '').toLowerCase();
  const has = (...kw: string[]) => kw.some((k) => t.includes(k));
  const luxury = has('lusso', 'luxury', 'di lusso', 'esclusiv', 'prestige', 'high-end', 'high end', '5 stelle', 'cinque stelle', 'alta gamma');

  // 1) Auto sportive / supercar / performance → athletic-premium (editorial-luxury solo se lusso esplicito)
  if (has('supercar', 'hypercar') || (has('auto', 'vettur') && has('sportiv', 'performance', 'da corsa', 'racing'))) {
    return luxury ? 'editorial-luxury' : 'athletic-premium';
  }
  // 2) Auto di lusso esplicite → editorial-luxury
  if (has('luxury car', 'auto di lusso') || (has('noleggio') && has('auto', 'vettur') && luxury)) {
    return 'editorial-luxury';
  }
  // 3) Noleggio furgoni / flotte / mezzi da lavoro / macchinari → industrial-bold
  if (has('furgon', 'flotte', 'flotta', 'mezzi da lavoro', 'macchinari', 'muletti', 'escavator', 'noleggio mezzi', 'veicoli commerciali')) {
    return 'industrial-bold';
  }
  // 4) Edilizia / officina / logistica / manifattura → industrial-bold
  if (has('edilizia', 'costruzioni', 'impresa edile', 'ristrutturazion', 'officina', 'meccanico', 'carrozzeria', 'logistica', 'trasporti', 'spedizion', 'manifattur', 'metalmecc', 'fabbrica', 'magazzino')) {
    return 'industrial-bold';
  }
  // 5) Noleggio auto generico (consumer) → scandinavian-service
  if (has('noleggio auto', 'autonoleggio', 'rent a car', 'noleggio veicoli', 'noleggio macchine')) {
    return 'scandinavian-service';
  }
  // 6) Ristorazione di fascia alta / chef → editorial-luxury
  if (has('fine dining', 'gourmet', 'stellat', 'michelin', 'degustazione', 'alta cucina', 'chef')) {
    return 'editorial-luxury';
  }
  // 7) Ospitalità premium → editorial-luxury
  if (has('hotel', 'resort', 'boutique hotel', 'relais', 'dimora di charme', 'villa di lusso')) {
    return 'editorial-luxury';
  }
  // 8) Ristorazione casual / quartiere → warm-bistro se attivo, fallback prudente a scandinavian-service.
  if (has('pizzeria', 'pizza', 'trattoria', 'osteria', 'bistrot', 'paninoteca', 'panificio', 'panetteria', 'forno', 'forno a legna', 'gelateria', 'pasticceria', 'rosticceria', 'tavola calda', 'ristorant', 'enoteca', 'caffetteria', 'caffe', 'bar', 'pub', 'agriturismo', 'catering', 'food truck', 'cucina locale')) {
    return process.env.BRIK_THEME_BISTRO === 'on' ? 'warm-bistro' : 'scandinavian-service';
  }
  // 9) Pet grooming / toelettatura → scandinavian-service (editorial-luxury solo se lusso esplicito)
  if (has('toelettatura', 'toelettatore', 'toeletta', 'pet grooming', 'dog grooming', 'pet spa')) {
    return luxury ? 'editorial-luxury' : 'scandinavian-service';
  }
  // 10) SaaS / software / app / AI → modern-saas
  if (has('saas', 'software', 'gestionale', 'crm', 'erp', 'applicazione', 'web app', 'mobile app', 'startup tech', 'b2b software', 'dashboard', 'intelligenza artificiale', 'machine learning', 'piattaforma software', 'piattaforma saas', 'piattaforma digitale')) {
    return 'modern-saas';
  }
  // 11) Fotografia / design / branding / portfolio → creative-studio
  if (has('fotograf', 'portfolio', 'design', 'branding', 'brand identity', 'grafic', 'art direction', 'illustrazion', 'agenzia creativa', 'studio creativo')) {
    return 'creative-studio';
  }
  // 12) Fitness / sport → athletic-premium
  if (has('palestra', 'fitness', 'gym', 'crossfit', 'personal trainer', 'padel', 'tennis', 'calcetto', 'allenament', 'bodybuilding', 'pilates', 'sport')) {
    return 'athletic-premium';
  }
  // 13) Architettura / finanza / fintech / innovazione, e consulenza PREMIUM esplicita → future-minimal
  if (has('architett', 'finanza', 'fintech', 'investiment', 'wealth', 'innovazione', 'venture', 'deep tech', 'ricerca e sviluppo') || (has('consulenza', 'consulente', 'advisory') && (luxury || has('premium', 'top management', 'alto profilo')))) {
    return 'future-minimal';
  }
  // 14) Consulenza generica → scandinavian-service
  if (has('consulenza', 'consulente', 'advisory', 'studio di consulenza')) {
    return 'scandinavian-service';
  }
  // 15) Studio legale / notarile → editorial-luxury (autorevolezza; coerente col seed esistente)
  if (has('avvocat', 'studio legale', 'notaio', 'law firm', 'attorney', 'contenzioso')) {
    return 'editorial-luxury';
  }
  // 16) Dentista / medicale → scandinavian-service (mai editorial-luxury senza lusso esplicito)
  if (has('dentist', 'odontoiatr', 'dental', 'ortodonzia', 'fisioterap', 'poliambulatorio', 'studio medico', 'clinica')) {
    return 'scandinavian-service';
  }
  // 17) Associazioni / eventi / corsi / community / coworking → modern-community
  if (has('associazione', 'onlus', 'no profit', 'no-profit', 'volontariat', 'eventi', 'evento', 'corsi', 'formazione', 'community', 'coworking', 'scuola', 'accademia', 'festival', 'fondazione')) {
    return 'modern-community';
  }
  // 18) Fallback sicuro: mai noir di default.
  return 'scandinavian-service';
}

/**
 * Comodo: rileva il settore dalla descrizione e ne compone la CreativeDirection.
 * Punto d'ingresso unico del livello decisionale. Il TEMA viene deciso a livello di
 * descrizione (keyword), sovrascrivendo quello del seed: così pizzeria e ristorante
 * gourmet — stesso settore 'restaurant' — ottengono temi diversi, e le categorie non
 * mappate non cadono mai sul default noir.
 */
export function creativeDirectionFromDescription(description: string): CreativeDirection {
  const industry = detectIndustry(description);
  const cd = creativeDirectionForIndustry(industry, { detected: industry !== 'generic' });
  return { ...cd, recommendedTheme: recommendedThemeFromDescription(description) };
}

/** Etichette italiane per il prompt (le forme inglesi restano nei seed/log). */
const INDUSTRY_LABEL: Record<Industry, string> = {
  restaurant: 'ristorante',
  dentist: 'studio dentistico',
  law_firm: 'studio legale',
  creative_agency: 'agenzia creativa',
  consulting_advisory: 'studio di consulenza',
  generic: 'generico',
};
const EMOTION_LABEL: Record<string, string> = {
  Desire: 'desiderio',
  Reassurance: 'rassicurazione',
  Trust: 'fiducia',
  'Creative Authority': 'autorevolezza creativa',
  'Considered Authority': 'autorevolezza senza ostentazione',
};

/**
 * Trasforma la CreativeDirection in POCHE righe sintetiche per il prompt (Step 3).
 * Formato fisso: settore, emozione, pattern, tema consigliato, CTA, max 3 anti-cliché,
 * max 3 direttive terse. Per `generic` o settore non rilevato restituisce [] →
 * nessun blocco nel prompt, comportamento invariato. Tenuto corto di proposito:
 * troppe regole nel prompt ne peggiorerebbero l'aderenza.
 */
export function creativeNotesFor(cd: CreativeDirection): string[] {
  if (cd.industry === 'generic' || !cd.detected) return [];
  const patternLabel =
    cd.dominantPattern !== 'none' ? PATTERN_DB[cd.dominantPattern]?.label ?? cd.dominantPattern : '';
  const lines: string[] = [];
  lines.push('- settore rilevato: ' + (INDUSTRY_LABEL[cd.industry] ?? cd.industry));
  if (cd.primaryEmotion) lines.push('- emozione: ' + (EMOTION_LABEL[cd.primaryEmotion] ?? cd.primaryEmotion.toLowerCase()));
  if (patternLabel) lines.push('- pattern: ' + patternLabel);
  if (cd.recommendedTheme) lines.push('- tema consigliato: ' + cd.recommendedTheme);
  if (cd.ctaSeed) lines.push('- CTA sito: ' + cd.ctaSeed);
  // Direttive del pattern: ESPLICITE e imperative, TUTTE (non solo l'etichetta).
  if (cd.directives.length) {
    lines.push('- DIRETTIVE DEL PATTERN (imperative, rispettale tutte):');
    for (const d of cd.directives) lines.push('  \u2022 ' + d);
  }
  if (cd.directionHints.length) lines.push('- direzione: ' + cd.directionHints.slice(0, 3).join(', '));
  // Anti-cliché come riga DURA e completa (non troncata): sono divieti, non consigli.
  if (cd.antiCliches.length) lines.push('- VIETATO (rispetta TUTTI, senza eccezioni): ' + cd.antiCliches.join('; ') + '.');
  // Divieti tassativi universali per i settori rilevati: anti-pattern che abbassano sempre la qualità.
  lines.push('- DIVIETI TASSATIVI: nessuna emoji; nessun contatore animato e nessun attributo data-count; nessuna metrica o statistica inventata; mai le frasi "soluzioni creative", "partner ideale", "innovazione" come riempitivo; nessuna struttura da builder (hero \u2192 servizi \u2192 numeri \u2192 testimonianze \u2192 CTA); nessuna griglia di card uniformi con icone.');
  if (cd.photoSubjects && cd.photoSubjects.length) lines.push('- foto consigliate (soggetti per le query immagini): ' + cd.photoSubjects.join('; '));
  if (cd.photoAvoid && cd.photoAvoid.length) lines.push('- foto da evitare assolutamente: ' + cd.photoAvoid.join('; '));
  if (cd.narrative) lines.push('- racconto del sito (ogni sezione e un passo di questo arco): ' + cd.narrative);
  if (cd.voice) lines.push('- voce dei testi, servizi inclusi (mai schede tecniche generiche): ' + cd.voice);
  return lines;
}

/**
 * Step 4 — scelta del tema preferito.
 *
 * Decide quale tema passare al generatore rispettando la gerarchia richiesta:
 *  1) se l'utente ha indicato un tema esplicito, PREVALE sempre (non lo tocchiamo);
 *  2) altrimenti, se la creative_direction ha un recommendedTheme VALIDO, diventa
 *     il tema preferito;
 *  3) altrimenti `null` → il generatore usa il suo default attuale (nessun cambio).
 *
 * Il validatore `isValidTheme` è iniettato come parametro: così questo modulo del
 * livello decisionale resta disaccoppiato dagli adapter (non importa isTheme) ed è
 * unit-testabile con un validatore finto. È una sicurezza RIDONDANTE: il generatore
 * valida comunque il tema a valle, quindi un recommendedTheme errato ricade sul default.
 */
export function preferredTheme(
  userTheme: string | undefined,
  cd: Pick<CreativeDirection, 'recommendedTheme'>,
  isValidTheme: (t: string) => boolean,
): { readonly theme: string | null; readonly source: 'user' | 'creative_direction' | 'default' } {
  // 1) Scelta utente esplicita: prevale. (A monte server.ts l'ha già validata.)
  if (userTheme) return { theme: userTheme, source: 'user' };
  // 2) Suggerimento del livello decisionale, solo se è un tema realmente esistente.
  const rec = cd.recommendedTheme;
  if (rec && isValidTheme(rec)) return { theme: rec, source: 'creative_direction' };
  // 3) Fallback sicuro: comportamento attuale invariato.
  return { theme: null, source: 'default' };
}
