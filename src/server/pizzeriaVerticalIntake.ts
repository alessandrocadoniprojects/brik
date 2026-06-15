/**
 * Pizzeria Pack v1 — Patch 5: intake verticale pizzeria.
 *
 * Quando il progetto è chiaramente una pizzeria, propone domande specifiche e
 * deterministiche che popolano il PizzeriaBusinessProfile. Adattivo: salta ciò che
 * è già noto (profilo o starting point). Niente è inventato: queste sono preferenze
 * e intenzioni dell'utente, non dati di contatto.
 *
 * Tre funzioni pure e testabili:
 *  - planPizzeriaIntake: decide se attivare e quali domande mostrare;
 *  - applyPizzeriaIntakeAnswers: mappa le risposte sul profilo;
 *  - ensurePizzeriaProfile: crea il profilo se manca ma la descrizione è pizzeria.
 */

import {
  isPizzeriaDescription,
  extractPizzeriaBusinessProfile,
  type PizzeriaBusinessProfile,
  type PizzeriaType,
  type PizzeriaPrimaryCta,
  type PizzeriaMood,
} from './pizzeriaProfile.js';
import { isPizzeriaStylePreset, type PizzeriaStylePreset } from '../core/pizzeriaPresets.js';
import type { StartingPointIntake } from './startingPoint.js';

export type VerticalQuestionId = 'name' | 'type' | 'strength' | 'cta' | 'mood' | 'products' | 'photos' | 'opdata';

export interface VerticalQuestion {
  id: VerticalQuestionId;
  question: string;
  options?: string[];
  multi?: boolean;
  freeText?: boolean;
}

// --- Opzioni e mapping (label mostrata -> valore salvato) ------------------

const TYPE_OPTIONS: ReadonlyArray<[string, PizzeriaType]> = [
  ['Napoletana tradizionale', 'napoletana'],
  ['Contemporanea', 'contemporanea'],
  ['Al taglio / asporto', 'al-taglio'],
  ['Familiare di quartiere', 'familiare'],
  ['Gourmet / ingredienti ricercati', 'gourmet'],
  ['Pizzeria + birre / vini', 'pizza-birre-vini'],
];

const STRENGTH_OPTIONS: ReadonlyArray<[string, string]> = [
  ['Forno a legna', 'forno-a-legna'],
  ['Impasto a lunga lievitazione', 'lunga-lievitazione'],
  ['Ingredienti selezionati', 'ingredienti-selezionati'],
  ['Prezzi accessibili', 'prezzi-accessibili'],
  ["Atmosfera del locale", 'atmosfera-locale'],
  ['Pizza signature', 'pizza-signature'],
];

const CTA_OPTIONS: ReadonlyArray<[string, 'prenota' | 'menu' | 'contact' | 'asporto' | 'maps']> = [
  ['Prenotare un tavolo', 'prenota'],
  ['Guardare il menu', 'menu'],
  ['Chiamare / WhatsApp', 'contact'],
  ['Ordinare asporto', 'asporto'],
  ['Trovare il locale su Maps', 'maps'],
];

const MOOD_OPTIONS: ReadonlyArray<[string, PizzeriaMood]> = [
  ['Calda e tradizionale', 'warm-traditional'],
  ['Giovane e vivace', 'young-vibrant'],
  ['Minimal contemporanea', 'minimal-contemporary'],
  ['Serale e intima', 'evening-intimate'],
  ['Familiare e accogliente', 'family-welcoming'],
  ['Premium e curata', 'premium-curated'],
];

const PRODUCT_OPTIONS: ReadonlyArray<[string, string]> = [
  ['Pizze classiche', 'pizze-classiche'],
  ['Pizze signature', 'pizze-signature'],
  ['Fritti / antipasti', 'fritti-antipasti'],
  ['Dolci', 'dolci'],
  ['Birre / vini', 'birre-vini'],
  ['Menu completo', 'menu-completo'],
];

const PHOTO_OPTIONS: ReadonlyArray<[string, keyof NonNullable<PizzeriaBusinessProfile['photos']> | 'none']> = [
  ['Pizze', 'hasRealPizzaPhotos'],
  ['Forno', 'hasRealOvenPhotos'],
  ['Locale', 'hasRealInteriorPhotos'],
  ['Staff', 'hasRealStaffPhotos'],
  ['No', 'none'],
];

const OPDATA_OPTIONS: ReadonlyArray<[string, string]> = [
  ['Orari', 'orari'],
  ['Indirizzo', 'indirizzo'],
  ['Telefono', 'telefono'],
  ['WhatsApp', 'whatsapp'],
  ['Google Maps', 'google-maps'],
  ['Social', 'social'],
];

const labels = (opts: ReadonlyArray<[string, unknown]>): string[] => opts.map((o) => o[0]);
const valueOf = (opts: ReadonlyArray<[string, string]>, label: string): string | undefined => {
  const hit = opts.find((o) => o[0].toLowerCase() === String(label).trim().toLowerCase());
  return hit ? hit[1] : undefined;
};

// --- Planner ----------------------------------------------------------------

/** Vero se il progetto va trattato come pizzeria (descrizione chiara o profilo già pizzeria). */
export function isPizzeriaProject(description: string, profile?: PizzeriaBusinessProfile | null): boolean {
  return !!profile || isPizzeriaDescription(description || '');
}

export interface PizzeriaIntakePlan {
  active: boolean;
  questions: VerticalQuestion[];
}

const Q: Record<VerticalQuestionId, VerticalQuestion> = {
  name: { id: 'name', question: 'Come si chiama la pizzeria?', freeText: true },
  type: { id: 'type', question: 'Che tipo di pizzeria è?', options: labels(TYPE_OPTIONS) },
  strength: { id: 'strength', question: 'Qual è il punto forte?', options: labels(STRENGTH_OPTIONS), multi: true },
  cta: { id: 'cta', question: 'Qual è la cosa più importante che deve fare chi visita il sito?', options: labels(CTA_OPTIONS) },
  mood: { id: 'mood', question: 'Che atmosfera vuoi trasmettere?', options: labels(MOOD_OPTIONS) },
  products: { id: 'products', question: 'Quali prodotti vuoi mettere in evidenza?', options: labels(PRODUCT_OPTIONS), multi: true },
  photos: { id: 'photos', question: 'Hai foto reali da usare?', options: labels(PHOTO_OPTIONS), multi: true },
  opdata: { id: 'opdata', question: 'Quali dati operativi vuoi mostrare?', options: labels(OPDATA_OPTIONS), multi: true },
};

/**
 * Costruisce il piano di domande verticali. Non attivo se non è una pizzeria.
 * Salta le domande già risolte dal profilo o dallo starting point e adatta il
 * numero in base al mode (guided → più domande; existing-site → solo le essenziali).
 */
export function planPizzeriaIntake(args: {
  description: string;
  profile?: PizzeriaBusinessProfile | null;
  startingPoint?: StartingPointIntake | null;
}): PizzeriaIntakePlan {
  const { description, profile, startingPoint } = args;
  if (!isPizzeriaProject(description || '', profile)) return { active: false, questions: [] };

  const p = profile || undefined;
  const mode = startingPoint?.mode;
  const hasMenuText = startingPoint?.mode === 'materials' && !!startingPoint.materials?.menuText;

  const core: VerticalQuestion[] = [];
  const extra: VerticalQuestion[] = [];

  if (!p?.businessName) core.push(Q.name);
  if (!p?.pizzeriaType || p.pizzeriaType === 'generic') core.push(Q.type);
  if (!p?.primaryCta) core.push(Q.cta);
  if (!p?.desiredMood) core.push(Q.mood);

  if (!p?.strengths || p.strengths.length === 0) extra.push(Q.strength);
  if ((!p?.highlightedProducts || p.highlightedProducts.length === 0) && !hasMenuText) extra.push(Q.products);
  if (!p?.photos) extra.push(Q.photos);
  if (!p?.requestedOperationalData || p.requestedOperationalData.length === 0) extra.push(Q.opdata);

  let questions: VerticalQuestion[];
  if (mode === 'existing-site') {
    // sito già esistente: chiediamo poco, niente domande secondarie
    questions = core;
  } else if (mode === 'guided-from-zero') {
    // utente da zero: raccogliamo il massimo utile
    questions = [...core, ...extra];
  } else {
    questions = [...core, ...extra];
  }

  questions = questions.slice(0, 8); // tetto duro 6-8
  return { active: questions.length > 0, questions };
}

// --- Applicazione risposte --------------------------------------------------

function clone(p: PizzeriaBusinessProfile): PizzeriaBusinessProfile {
  return JSON.parse(JSON.stringify(p)) as PizzeriaBusinessProfile;
}
function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string' && v.trim()) return [v];
  return [];
}

export type PizzeriaIntakeAnswers = Partial<Record<VerticalQuestionId, string | string[]>> & { stylePreset?: PizzeriaStylePreset };

/**
 * Applica le risposte dell'intake verticale al profilo. Lavora su una copia.
 * Ogni campo viene scritto solo se la risposta è valida; nulla viene inventato.
 */
export function applyPizzeriaIntakeAnswers(
  profile: PizzeriaBusinessProfile,
  answers: PizzeriaIntakeAnswers,
): { profile: PizzeriaBusinessProfile; changed: boolean } {
  const np = clone(profile);
  let changed = false;

  // Preset gallery: accetta solo gli otto identificatori canonici.
  if (isPizzeriaStylePreset(answers.stylePreset) && np.stylePreset !== answers.stylePreset) {
    np.stylePreset = answers.stylePreset;
    changed = true;
  }

  // 1) Nome
  const name = typeof answers.name === 'string' ? answers.name.trim() : '';
  if (name && np.businessName !== name) { np.businessName = name; changed = true; }

  // 2) Tipo (+ takeaway se al-taglio)
  if (typeof answers.type === 'string') {
    const ans = answers.type.trim().toLowerCase();
    const t = TYPE_OPTIONS.find((o) => o[0].toLowerCase() === ans);
    if (t) {
      if (np.pizzeriaType !== t[1]) { np.pizzeriaType = t[1]; changed = true; }
      if (t[1] === 'al-taglio') { np.services = { ...(np.services || {}), takeaway: true }; changed = true; }
    }
  }

  // 3) Punto forte
  const strengths = asArray(answers.strength).map((l) => valueOf(STRENGTH_OPTIONS, l)).filter((v): v is string => !!v);
  if (strengths.length) { np.strengths = strengths; changed = true; }

  // 4) Azione principale
  if (typeof answers.cta === 'string') {
    const ans = answers.cta.trim().toLowerCase();
    const c = CTA_OPTIONS.find((o) => o[0].toLowerCase() === ans);
    if (c) {
      let cta: PizzeriaPrimaryCta | undefined;
      if (c[1] === 'contact') cta = np.whatsapp ? 'whatsapp' : 'chiama';
      else if (c[1] === 'asporto') { cta = 'asporto'; np.services = { ...(np.services || {}), takeaway: true }; }
      else cta = c[1];
      if (cta && np.primaryCta !== cta) { np.primaryCta = cta; changed = true; }
    }
  }

  // 5) Atmosfera
  if (typeof answers.mood === 'string') {
    const ans = answers.mood.trim().toLowerCase();
    const m = MOOD_OPTIONS.find((o) => o[0].toLowerCase() === ans);
    if (m && np.desiredMood !== m[1]) { np.desiredMood = m[1]; changed = true; }
  }

  // 6) Prodotti
  const products = asArray(answers.products).map((l) => valueOf(PRODUCT_OPTIONS, l)).filter((v): v is string => !!v);
  if (products.length) { np.highlightedProducts = products; changed = true; }

  // 7) Foto
  const photoLabels = asArray(answers.photos);
  if (photoLabels.length && !photoLabels.some((l) => l.trim().toLowerCase() === 'no')) {
    const photos = { ...(np.photos || {}) };
    for (const l of photoLabels) {
      const hit = PHOTO_OPTIONS.find((o) => o[0].toLowerCase() === l.trim().toLowerCase());
      if (hit && hit[1] !== 'none') (photos as Record<string, boolean>)[hit[1]] = true;
    }
    np.photos = photos;
    changed = true;
  }

  // 8) Dati operativi desiderati
  const opdata = asArray(answers.opdata).map((l) => valueOf(OPDATA_OPTIONS, l)).filter((v): v is string => !!v);
  if (opdata.length) { np.requestedOperationalData = opdata; changed = true; }

  return { profile: np, changed };
}

/**
 * Restituisce un profilo su cui applicare le risposte: quello esistente se c'è,
 * altrimenti uno nuovo (estratto dalla descrizione) SOLO se è davvero una pizzeria.
 * Per i non-pizzeria ritorna undefined: non si crea mai un profilo.
 */
export function ensurePizzeriaProfile(
  description: string,
  profile?: PizzeriaBusinessProfile | null,
): PizzeriaBusinessProfile | undefined {
  if (profile) return profile;
  if (!isPizzeriaDescription(description || '')) return undefined;
  return extractPizzeriaBusinessProfile(description || '') || { pizzeriaType: 'generic' };
}
