/**
 * Pizzeria Pack v1 — Patch 2: PizzeriaBusinessProfile.
 *
 * Modello dati OPZIONALE per il verticale pizzeria. In questa patch è solo dati:
 * un tipo, un rilevatore stretto e un estrattore conservativo dalla descrizione
 * iniziale. NON genera HTML, NON tocca il prompt, NON inventa nulla.
 *
 * Principio cardine dell'estrazione: estrai SOLO ciò che è esplicito e
 * ragionevolmente sicuro. Telefono, WhatsApp, email, indirizzo, prezzi, orari,
 * città, menu, P.IVA, link Maps e social NON vengono mai inventati: se non sono
 * scritti, restano assenti.
 */

import type { PizzeriaStylePreset } from '../core/pizzeriaPresets.js';

export type PizzeriaType =
  | 'napoletana'
  | 'contemporanea'
  | 'al-taglio'
  | 'familiare'
  | 'gourmet'
  | 'pizza-birre-vini'
  | 'generic';

export type PizzeriaPrimaryCta = 'prenota' | 'whatsapp' | 'chiama' | 'menu' | 'maps' | 'asporto';

export type PizzeriaMood =
  | 'warm-traditional'
  | 'young-vibrant'
  | 'minimal-contemporary'
  | 'evening-intimate'
  | 'family-welcoming'
  | 'premium-curated';

export interface PizzeriaBusinessProfile {
  /** Preset verticale scelto esplicitamente nella gallery pizzerie. */
  stylePreset?: PizzeriaStylePreset;
  businessName?: string;
  pizzeriaType?: PizzeriaType;
  claim?: string;
  address?: string;
  city?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  googleMapsUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  openingHours?: {
    raw?: string;
    days?: Array<{ day: string; open?: string; close?: string; closed?: boolean }>;
  };
  primaryCta?: PizzeriaPrimaryCta;
  services?: {
    dineIn?: boolean;
    takeaway?: boolean;
    delivery?: boolean;
    reservation?: boolean;
    outdoorTables?: boolean;
  };
  menu?: {
    categories: Array<{
      name: string;
      items: Array<{ name: string; description?: string; price?: string; highlighted?: boolean }>;
    }>;
  };
  photos?: {
    hasRealPizzaPhotos?: boolean;
    hasRealOvenPhotos?: boolean;
    hasRealInteriorPhotos?: boolean;
    hasRealStaffPhotos?: boolean;
  };
  // Preferenze raccolte dall'intake verticale (Patch 5): non sono dati di contatto, mai inventati.
  strengths?: string[];
  desiredMood?: PizzeriaMood;
  highlightedProducts?: string[];
  requestedOperationalData?: string[];
}

/** Wrapper persistito (estendibile a futuri verticali con altri `kind`). */
export interface BusinessProfile {
  kind: 'pizzeria';
  data: PizzeriaBusinessProfile;
}

// ---------------------------------------------------------------------------
// Rilevamento (stretto: "ristorante" da solo NON basta)
// ---------------------------------------------------------------------------

/** Termini che indicano in modo specifico una pizzeria (non un generico ristorante). */
const PIZZERIA_TRIGGER =
  /\b(pizzeri[ae]|pizz[ae]|forno a legna|margherit[ae]|diavol[ae]|impast[oi]|lievitazion[ei]|al taglio)\b/i;

/** Vero se la descrizione riguarda chiaramente una pizzeria. */
export function isPizzeriaDescription(description: string): boolean {
  return PIZZERIA_TRIGGER.test(description || '');
}

// ---------------------------------------------------------------------------
// Estrazione sicura
// ---------------------------------------------------------------------------

/** Numeri palesemente segnaposto: non vanno mai estratti come reali. */
function isFakeNumber(n: string): boolean {
  const digits = n.replace(/\D/g, '');
  if (!digits) return true;
  if (/^0+$/.test(digits)) return true; // tutti zeri
  if (/0{5,}/.test(digits)) return true; // lunga sequenza di zeri (045 000 0000…)
  if (digits === '1234567890') return true;
  return false;
}

/** Nome attività: "Pizzeria <Nome proprio>", fermandosi prima della città/descrittori. */
function extractBusinessName(d: string): string | undefined {
  const m = d.match(/\bPizzeria\s+([A-ZÀ-Ù][\wÀ-ú'’.]*(?:\s+(?:[A-ZÀ-Ù][\wÀ-ú'’.]*|e|di|del|della|da|al|alla))*)/);
  if (!m || !m[1]) return undefined;
  let name = ('Pizzeria ' + m[1]).replace(/\s+/g, ' ').trim();
  // taglia su preposizione di luogo che introduce la città (a/in/presso/vicino)
  name = name.replace(/\s+(?:a|in|presso|vicino)\b[\s\S]*$/i, '').trim();
  const tail = name.replace(/^Pizzeria\s*/i, '').trim();
  // "Pizzeria" da sola o seguita solo da descrittori comuni non è un nome
  if (!tail) return undefined;
  if (/^(napoletana|contemporanea|gourmet|familiare|al taglio|moderna|tradizionale)$/i.test(tail)) return undefined;
  return name;
}

/** Città: dopo "a/in/di/zona/provincia di", parola(e) capitalizzata(e). */
function extractCity(d: string): string | undefined {
  const m = d.match(/\b(?:a|in|di|zona|provincia di)\s+([A-ZÀ-Ù][a-zà-ù'’]+(?:\s+[A-ZÀ-Ù][a-zà-ù'’]+){0,2})/);
  if (!m || !m[1]) return undefined;
  const city = m[1].trim();
  // scarta falsi positivi comuni ("a Legna" di "forno a legna" è minuscolo, quindi non entra qui)
  if (/^(legna|domicilio|casa|pranzo|cena)$/i.test(city)) return undefined;
  return city;
}

const PHONE_RE = /(\+?39[\s.]?)?((?:3\d{2}|0\d{1,3})[\s.\-]?\d{5,8})/;

function extractWhatsapp(d: string): string | undefined {
  const m = d.match(/whats?app[^0-9+]{0,12}(\+?\d[\d\s.\-]{6,}\d)/i);
  if (!m || !m[1]) return undefined;
  const num = m[1].replace(/[^\d+]/g, '');
  return num.replace(/\D/g, '').length >= 7 && !isFakeNumber(num) ? num : undefined;
}

function extractPhone(d: string): string | undefined {
  // solo se introdotto da un'etichetta telefonica (evita di catturare numeri non-telefonici)
  const m = d.match(/(?:tel(?:efono)?|chiama(?:ci|teci)?|numero|cell(?:ulare)?)[^0-9+]{0,12}(\+?\d[\d\s.\-]{6,}\d)/i);
  if (!m || !m[1]) return undefined;
  const num = m[1].replace(/[^\d+]/g, '');
  return num.replace(/\D/g, '').length >= 7 && !isFakeNumber(num) ? num : undefined;
}

function extractEmail(d: string): string | undefined {
  const m = d.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
  if (!m) return undefined;
  const email = m[0];
  if (/@example\.(com|org|net|it)$/i.test(email) || /^email@/i.test(email)) return undefined;
  return email;
}

function extractSocial(d: string, host: RegExp): string | undefined {
  const m = d.match(new RegExp('https?:\\/\\/(?:www\\.)?' + host.source + '\\/[A-Za-z0-9_.\\-]+', 'i'));
  if (!m) return undefined;
  const url = m[0];
  if (/\/(yourpage|username|example|tuonome|tua-?pagina|handle|profilo)\b/i.test(url)) return undefined;
  return url;
}

/** Orari grezzi: stringa così com'è scritta, senza interpretarla (days verrà in patch successive). */
function extractOpeningHoursRaw(d: string): string | undefined {
  // "aperti/orari ... <orario hh:mm>"
  const m = d.match(/(?:apert[oi]|orari?o?)\b[:\s]+([^.;]*\d{1,2}[:.]\d{2}[^.;]*)/i);
  if (m && m[1]) return m[1].trim().replace(/\s+/g, ' ');
  // range di giorni seguito da un orario, senza la parola "aperti"
  const m2 = d.match(/((?:luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica)[^.;]*\d{1,2}[:.]\d{2}[^.;]*)/i);
  if (m2 && m2[1]) return m2[1].trim().replace(/\s+/g, ' ');
  return undefined;
}

function extractType(d: string): PizzeriaType {
  const s = d.toLowerCase();
  if (/\bal taglio\b/.test(s)) return 'al-taglio';
  if (/\bgourmet\b/.test(s)) return 'gourmet';
  if (/\bcontemporane/.test(s)) return 'contemporanea';
  if (/\b(napoletana|forno a legna)\b/.test(s)) return 'napoletana';
  if (/\b(pizza e birr|birre e vin|pizza,? birr|birra e vin)/.test(s)) return 'pizza-birre-vini';
  if (/\b(familiar|di famiglia|a conduzione familiare)\b/.test(s)) return 'familiare';
  return 'generic';
}

function extractServices(d: string): PizzeriaBusinessProfile['services'] | undefined {
  const s = d.toLowerCase();
  const out: NonNullable<PizzeriaBusinessProfile['services']> = {};
  if (/\b(asporto|take\s?away|takeaway|da portar via)\b/.test(s)) out.takeaway = true;
  if (/\b(delivery|consegn[ae] a domicilio|a domicilio)\b/.test(s)) out.delivery = true;
  if (/\b(prenotazion|su prenotazione|prenot[ai])\b/.test(s)) out.reservation = true;
  if (/\b(tavoli all'aperto|all'aperto|dehor|spazio esterno|giardino)\b/.test(s)) out.outdoorTables = true;
  return Object.keys(out).length ? out : undefined;
}

function extractPrimaryCta(
  d: string,
  ctx: { whatsapp?: string | undefined; services?: PizzeriaBusinessProfile['services'] | undefined },
): PizzeriaPrimaryCta | undefined {
  const s = d.toLowerCase();
  if (ctx.whatsapp) return 'whatsapp';
  if (/\b(prenotazion|prenot[ai])\b/.test(s)) return 'prenota';
  if (ctx.services?.takeaway) return 'asporto';
  if (/\b(chiama|telefon)/.test(s)) return 'chiama';
  return undefined;
}

/**
 * Estrae un PizzeriaBusinessProfile dalla descrizione. Ritorna null se NON è una
 * pizzeria. Tutti i campi sono opzionali e popolati solo quando esplicitamente
 * presenti: niente è mai inventato.
 */
export function extractPizzeriaBusinessProfile(description: string): PizzeriaBusinessProfile | null {
  const d = (description || '').trim();
  if (!isPizzeriaDescription(d)) return null;

  const profile: PizzeriaBusinessProfile = {};

  const businessName = extractBusinessName(d);
  if (businessName) profile.businessName = businessName;

  profile.pizzeriaType = extractType(d); // sempre valorizzato ('generic' se non chiaro)

  const city = extractCity(d);
  if (city) profile.city = city;

  const whatsapp = extractWhatsapp(d);
  if (whatsapp) profile.whatsapp = whatsapp;

  const phone = extractPhone(d);
  if (phone) profile.phone = phone;

  const email = extractEmail(d);
  if (email) profile.email = email;

  const instagram = extractSocial(d, /instagram\.com/);
  if (instagram) profile.instagramUrl = instagram;
  const facebook = extractSocial(d, /facebook\.com/);
  if (facebook) profile.facebookUrl = facebook;

  const hoursRaw = extractOpeningHoursRaw(d);
  if (hoursRaw) profile.openingHours = { raw: hoursRaw };

  const services = extractServices(d);
  if (services) profile.services = services;

  const primaryCta = extractPrimaryCta(d, { whatsapp, services });
  if (primaryCta) profile.primaryCta = primaryCta;

  return profile;
}
