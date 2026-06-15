/**
 * Pizzeria Pack v1 — Patch 3B: edit deterministici di menu e orari.
 *
 * Helper puri che riconoscono alcune modifiche frequenti scritte in italiano e le
 * applicano al PizzeriaBusinessProfile, senza LLM. Conservativi: non inventano
 * prezzi, pizze, orari o categorie piene; se non riconoscono la richiesta tornano
 * handled:false e si lascia passare l'edit normale.
 *
 * Il profilo in input NON viene mutato: si lavora su una copia e si restituisce il
 * profilo aggiornato solo quando qualcosa è effettivamente cambiato.
 */

import type { PizzeriaBusinessProfile } from './pizzeriaProfile.js';

export interface PizzeriaProfileEditResult {
  handled: boolean;
  /** Presente SOLO se il profilo è stato effettivamente modificato. */
  profile?: PizzeriaBusinessProfile;
  message?: string;
}

type Menu = NonNullable<PizzeriaBusinessProfile['menu']>;
type Category = Menu['categories'][number];

function clone(p: PizzeriaBusinessProfile): PizzeriaBusinessProfile {
  return JSON.parse(JSON.stringify(p)) as PizzeriaBusinessProfile;
}

function cap(s: string): string {
  const t = (s || '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Ripulisce un nome di pizza/voce da articoli e dalla parola "pizza". */
function cleanItemName(s: string): string {
  return cap(
    (s || '')
      .replace(/^(?:la|il|lo|le|gli|i|una?|un'|l'|delle?|dei|degli|della|pizza)\s+/i, '')
      .replace(/[.,!?;:]+$/, '')
      .trim(),
  );
}

function ensureMenu(p: PizzeriaBusinessProfile): Menu {
  if (!p.menu || !Array.isArray(p.menu.categories)) p.menu = { categories: [] };
  return p.menu;
}

function pizzaCategory(menu: Menu): Category {
  let cat = menu.categories.find((c) => /pizz/i.test(c.name));
  if (!cat) {
    cat = { name: 'Pizze', items: [] };
    menu.categories.push(cat);
  }
  return cat;
}

function findItem(menu: Menu, name: string): { cat: Category; item: Category['items'][number] } | null {
  const n = name.toLowerCase();
  for (const cat of menu.categories) for (const item of cat.items || []) {
    if ((item.name || '').toLowerCase() === n) return { cat, item };
  }
  return null;
}

function extractPrice(s: string): { price?: string; rest: string } {
  const pm = s.match(/(\d+(?:[.,]\d+)?)\s*(?:€|euro|eur)(?![a-zA-Z])/i);
  if (!pm) return { rest: s };
  const price = pm[1] + '€';
  const rest = s.replace(/\s*(?:a|ad|per|a\s+soli|costa)?\s*\d+(?:[.,]\d+)?\s*(?:€|euro|eur)(?![a-zA-Z])/i, '').trim();
  return { price, rest };
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function tryAddSection(p: PizzeriaBusinessProfile, msg: string): PizzeriaProfileEditResult | null {
  const m = msg.match(/\b(?:aggiungi|crea|inserisci|metti|nuova)\b[\s\S]*?\bsezion[ei]\b\s+(?:di\s+|per\s+|le\s+|i\s+|gli\s+|dei\s+|delle\s+)?(.+)/i);
  if (!m || !m[1]) return null;
  const name = cap(m[1].replace(/[.,!?;:]+$/, '').trim());
  if (!name) return null;
  const np = clone(p);
  const menu = ensureMenu(np);
  if (menu.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return { handled: true, message: `La sezione ${name} esiste già.` };
  }
  menu.categories.push({ name, items: [] });
  return { handled: true, profile: np, message: `Ho aggiunto la sezione ${name}.` };
}

function tryChangePrice(p: PizzeriaBusinessProfile, msg: string): PizzeriaProfileEditResult | null {
  const m = msg.match(/\b(?:cambia|aggiorna|modifica|imposta|porta|metti)\b[\s\S]*?\bprezzo\b\s*(?:della|del|di|dell'|alla|al|a)?\s*(.+?)\s+(?:a|in|ad)\s+(\d+(?:[.,]\d+)?)\s*(?:€|euro|eur)(?![a-zA-Z])/i);
  if (!m || !m[1]) return null;
  const name = cleanItemName(m[1]);
  const price = m[2] + '€';
  if (!name) return null;
  const np = clone(p);
  if (!np.menu) return { handled: true, message: `Non ho trovato la pizza ${name} nel menu. Vuoi aggiungerla?` };
  const found = findItem(np.menu, name);
  if (!found) return { handled: true, message: `Non ho trovato la pizza ${name} nel menu. Vuoi aggiungerla?` };
  found.item.price = price;
  return { handled: true, profile: np, message: `Ho aggiornato il prezzo di ${name} a ${price}.` };
}

function tryRemovePizza(p: PizzeriaBusinessProfile, msg: string): PizzeriaProfileEditResult | null {
  if (!/\b(togli|rimuovi|elimina|cancella|leva)\b/i.test(msg) || !/\bpizza\b/i.test(msg)) return null;
  const m = msg.match(/\bpizza\b\s+(.+)/i);
  if (!m || !m[1]) return null;
  const name = cleanItemName(m[1]);
  if (!name) return null;
  const np = clone(p);
  if (!np.menu) return { handled: true, message: `Non ho trovato la pizza ${name} nel menu.` };
  let removed = false;
  for (const cat of np.menu.categories) {
    const i = cat.items.findIndex((it) => (it.name || '').toLowerCase() === name.toLowerCase());
    if (i >= 0) { cat.items.splice(i, 1); removed = true; break; }
  }
  if (!removed) return { handled: true, message: `Non ho trovato la pizza ${name} nel menu.` };
  np.menu.categories = np.menu.categories.filter((c) => (c.items || []).length > 0); // categorie vuote via, è sicuro
  return { handled: true, profile: np, message: `Ho rimosso ${name} dal menu.` };
}

function tryAddPizza(p: PizzeriaBusinessProfile, msg: string): PizzeriaProfileEditResult | null {
  const m = msg.match(/\b(?:aggiungi|metti|inserisci|crea|nuova)\b[\s\S]*?\bpizza\b\s+(.+)/i);
  if (!m || !m[1]) return null;
  const { price, rest } = extractPrice(m[1].trim());
  let description: string | undefined;
  let namePart = rest;
  const dm = rest.match(/^(.*?)\s+con\s+(.+)$/i);
  if (dm && dm[1] && dm[2]) { namePart = dm[1]; description = dm[2].trim(); }
  const name = cleanItemName(namePart);
  if (!name) return null;
  const np = clone(p);
  const menu = ensureMenu(np);
  const cat = pizzaCategory(menu);
  const existing = cat.items.find((it) => (it.name || '').toLowerCase() === name.toLowerCase());
  if (existing) {
    let changed = false;
    if (price && existing.price !== price) { existing.price = price; changed = true; }
    if (description && existing.description !== description) { existing.description = description; changed = true; }
    if (!changed) return { handled: true, message: `La pizza ${name} è già nel menu.` };
    return { handled: true, profile: np, message: `Ho aggiornato ${name} nel menu.` };
  }
  const item: Category['items'][number] = { name };
  if (description) item.description = description;
  if (price) item.price = price;
  cat.items.push(item);
  return { handled: true, profile: np, message: `Ho aggiunto ${name}${price ? ' a ' + price : ''} nel menu.` };
}

// ---------------------------------------------------------------------------
// Orari (solo raw, nessun parsing giorno-per-giorno)
// ---------------------------------------------------------------------------

function isHoursEdit(msg: string): boolean {
  const s = msg.toLowerCase();
  if (/\borari?o?\b/.test(s)) return true;
  const dayOrTime = /\d{1,2}[:.]\d{2}/.test(s) || /(luned|marted|mercoled|gioved|venerd|sabato|domenic|tutti i giorni|festiv|serali|feriali)/i.test(s);
  if (/\b(apert[oi]|chius[oi])\b/.test(s) && dayOrTime) return true;
  return false;
}

function normalizeHoursRaw(msg: string): string | null {
  let s = msg.trim();
  s = s.replace(/^(?:per favore\s+)?(?:puoi\s+)?(?:aggiorna(?:re)?|modifica(?:re)?|imposta(?:re)?|cambia(?:re)?|metti|setta?)\s+(?:gli?\s+)?orari\s*[:\-–—]?\s*/i, '');
  s = s.replace(/^(?:i\s+nostri\s+)?orari(?:\s+sono)?\s*[:\-–—]?\s*/i, '');
  s = s.replace(/^siamo\s+/i, '');
  s = s.replace(/^apert[oi]\s+/i, '');
  s = s.replace(/\bda(?:l)?\s+([a-zA-ZÀ-ú]+)\s+a(?:lla|llo|l)?\s+([a-zA-ZÀ-ú]+)/i, '$1-$2'); // "dal X alla Y" -> "X-Y"
  s = s.replace(/\s+/g, ' ').replace(/[.;]+$/, '').trim();
  return s || null;
}

function tryHours(p: PizzeriaBusinessProfile, msg: string): PizzeriaProfileEditResult | null {
  if (!isHoursEdit(msg)) return null;
  const raw = normalizeHoursRaw(msg);
  if (!raw) return null;
  const np = clone(p);
  const hasTime = /\d{1,2}[:.]\d{2}/.test(msg);
  const prev = np.openingHours && np.openingHours.raw ? np.openingHours.raw : '';
  // con un orario è un set completo; senza (es. "Chiusi il lunedì") si integra a quello esistente
  const nextRaw = hasTime || !prev ? raw : prev + ', ' + raw;
  np.openingHours = { ...(np.openingHours || {}), raw: nextRaw };
  return { handled: true, profile: np, message: `Ho aggiornato gli orari: ${nextRaw}.` };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Prova ad applicare un edit deterministico di menu/orari. handled:false se la
 * richiesta non è riconosciuta (si lascerà passare all'edit LLM normale).
 */
export function applyPizzeriaProfileEdit(profile: PizzeriaBusinessProfile, userMessage: string): PizzeriaProfileEditResult {
  const msg = (userMessage || '').trim();
  if (!msg) return { handled: false };
  for (const fn of [tryAddSection, tryChangePrice, tryRemovePizza, tryAddPizza, tryHours]) {
    const r = fn(profile, msg);
    if (r) return r;
  }
  return { handled: false };
}
