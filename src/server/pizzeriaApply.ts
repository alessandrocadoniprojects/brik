/**
 * Pizzeria Pack v1 — Patch 3A: il PizzeriaBusinessProfile inizia a influenzare
 * l'HTML pubblico, in modo conservativo e solo quando il dato strutturato esiste.
 *
 * Tre interventi, tutti gated dalla presenza del dato:
 *   1) override dei placeholder di contatto con i dati reali del profilo;
 *   2) trasformazione dei CTA generici nel CTA primario (WhatsApp / chiama / Maps);
 *   3) una piccola "contact strip" prima del footer, solo se ci sono dati azionabili.
 *
 * Profilo assente (tutti i siti non-pizzeria) → l'HTML non viene toccato.
 * Niente è mai inventato: nessun prefisso internazionale aggiunto, nessun link
 * creato se il dato non c'è. Va eseguito PRIMA del sanitizer 1A, così i placeholder
 * con un corrispettivo reale vengono sostituiti e gli altri restano da rimuovere.
 */

import type { PizzeriaBusinessProfile } from './pizzeriaProfile.js';

// ---------------------------------------------------------------------------
// Normalizzazione numeri
// ---------------------------------------------------------------------------

/** Numero pronto per href tel:, oppure null se non valido/placeholder. */
export function normalizePhoneForHref(input: string): string | null {
  if (!input) return null;
  const hasPlus = input.trim().startsWith('+');
  const digits = input.replace(/\D/g, '');
  if (digits.length < 6) return null;
  if (/^0+$/.test(digits)) return null; // tutti zeri
  if (/0{5,}/.test(digits)) return null; // 045 000 0000 e simili
  if (digits === '1234567890') return null;
  return (hasPlus ? '+' : '') + digits;
}

/**
 * Link wa.me, SOLO se il numero ha un prefisso internazionale riconoscibile
 * (+ oppure 00…). Per i numeri nazionali senza prefisso NON genera il link:
 * wa.me senza country code sarebbe rotto, e la spec vieta di inventare prefissi.
 */
function waMeLink(input: string | undefined): string | null {
  if (!input) return null;
  const norm = normalizePhoneForHref(input);
  if (!norm) return null;
  if (norm.startsWith('+')) return 'https://wa.me/' + norm.slice(1);
  const digits = norm.replace(/\D/g, '');
  if (digits.startsWith('00')) return 'https://wa.me/' + digits.slice(2);
  return null; // numero senza prefisso internazionale: niente wa.me (eviterei un link rotto)
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(url: string): string {
  return String(url).replace(/"/g, '%22').replace(/\s/g, '%20');
}

// ---------------------------------------------------------------------------
// 1) Override dei placeholder di contatto con dati reali
// ---------------------------------------------------------------------------

const EMAIL_PLACEHOLDER = /([A-Za-z0-9._%+\-]+@example\.(?:com|org|net|it)|email@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/gi;
const PHONE_PLACEHOLDER_RES: readonly RegExp[] = [
  /\b045[\s.\-]?000[\s.\-]?0000\b/gi,
  /\b0{3}[\s.\-]?0{3}[\s.\-]?0{4}\b/gi,
  /\b123[\s.\-]?456[\s.\-]?7890\b/gi,
];

function overrideContacts(html: string, profile: PizzeriaBusinessProfile): string {
  let out = html;

  // Email: placeholder → email reale (testo e mailto:)
  if (profile.email) {
    out = out.replace(/mailto:([A-Za-z0-9._%+\-]+@example\.(?:com|org|net|it)|email@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/gi, 'mailto:' + profile.email);
    out = out.replace(EMAIL_PLACEHOLDER, profile.email);
  }

  // Telefono: placeholder → numero reale (preferisci phone, poi whatsapp)
  const realPhoneText = profile.phone || profile.whatsapp;
  const realPhoneHref = normalizePhoneForHref(profile.phone || profile.whatsapp || '');
  if (realPhoneText) {
    if (realPhoneHref) {
      out = out.replace(/tel:\+?[\d\s().\-]{6,}/gi, (m) => {
        const d = m.replace(/[^\d+]/g, '');
        // sostituisci solo gli href tel: palesemente placeholder
        return /^(\+?0+|.*0{5,}|\+?1234567890)$/.test(d) ? 'tel:' + realPhoneHref : m;
      });
    }
    for (const re of PHONE_PLACEHOLDER_RES) out = out.replace(re, realPhoneText);
  }

  // Indirizzo: "Via Esempio…" → indirizzo reale, oppure città se è l'unico dato
  const realAddress = profile.address || profile.city;
  if (realAddress) {
    out = out.replace(/Via\s+Esempio[A-Za-zÀ-ú0-9\s,'’]*\d*/gi, esc(realAddress));
  }

  // Nomi segnaposto → businessName reale
  if (profile.businessName) {
    out = out.replace(/\bNome\s+Pizzeria\b/gi, esc(profile.businessName));
    out = out.replace(/\bLa\s+tua\s+pizzeria\b/gi, esc(profile.businessName));
  }

  return out;
}

// ---------------------------------------------------------------------------
// 2) CTA primario
// ---------------------------------------------------------------------------

interface Cta {
  label: string;
  href: string;
  external: boolean;
}

function waCta(href: string, label = 'Scrivi su WhatsApp'): Cta {
  return { label, href, external: true };
}
function telCta(num: string, label = 'Chiama ora'): Cta {
  return { label, href: 'tel:' + num, external: false };
}
function mapsCta(url: string): Cta {
  return { label: 'Apri Maps', href: url, external: true };
}

/** Determina il CTA primario in base al profilo, con fallback WhatsApp → telefono. */
function resolveCta(profile: PizzeriaBusinessProfile): Cta | null {
  const wa = waMeLink(profile.whatsapp);
  const tel = profile.phone ? normalizePhoneForHref(profile.phone) : null;
  const maps = profile.googleMapsUrl || null;
  const cta = profile.primaryCta;

  if (cta === 'whatsapp' && wa) return waCta(wa);
  if (cta === 'chiama' && tel) return telCta(tel);
  if (cta === 'maps' && maps) return mapsCta(maps);
  if (cta === 'asporto') {
    if (wa) return waCta(wa, 'Ordina su WhatsApp');
    if (tel) return telCta(tel, 'Chiama per ordinare');
  }
  if (cta === 'prenota') {
    if (wa) return waCta(wa);
    if (tel) return telCta(tel);
  }
  // primaryCta assente o non soddisfacibile: preferisci WhatsApp, poi telefono
  if (wa) return waCta(wa);
  if (tel) return telCta(tel);
  return null;
}

/** Testi di CTA generici azionabili (esclude volutamente voci di menu come "Contatti"). */
const GENERIC_CTA_TEXT =
  /^(prenota(?:\s+(?:ora|adesso|subito|un\s+tavolo|il\s+tavolo|tavolo))?|contattaci|contattateci|ordina(?:\s+(?:ora|online|adesso))?|scrivici|richiedi(?:\s+informazioni|\s+info)?)$/i;

function setHref(attrs: string, href: string): string {
  const cleaned = attrs.replace(/\s*\btarget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/\s*\brel\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  if (/\bhref\s*=/.test(cleaned)) {
    return cleaned.replace(/\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, 'href="' + escAttr(href) + '"');
  }
  return cleaned + ' href="' + escAttr(href) + '"';
}

function applyPrimaryCta(html: string, profile: PizzeriaBusinessProfile): string {
  const cta = resolveCta(profile);
  if (!cta) return html;
  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (full, attrs: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!GENERIC_CTA_TEXT.test(text)) return full;
    const rel = cta.external ? ' target="_blank" rel="noopener"' : '';
    return '<a' + setHref(attrs, cta.href) + rel + '>' + esc(cta.label) + '</a>';
  });
}

// ---------------------------------------------------------------------------
// 3) Contact strip (additiva, sicura, solo con dati azionabili)
// ---------------------------------------------------------------------------

function pill(label: string, href: string, external: boolean): string {
  const ext = external ? ' target="_blank" rel="noopener"' : '';
  return (
    '<a href="' + escAttr(href) + '"' + ext +
    ' style="display:inline-block;padding:10px 18px;border:1px solid currentColor;border-radius:999px;' +
    'text-decoration:none;color:inherit;font:600 14px/1.2 system-ui,-apple-system,sans-serif">' +
    esc(label) + '</a>'
  );
}

function buildContactStrip(profile: PizzeriaBusinessProfile, links: { wa: string | null; tel: string | null; maps: string | null }, showHours: boolean): string {
  const buttons: string[] = [];
  if (links.wa) buttons.push(pill('Scrivi su WhatsApp', links.wa, true));
  if (links.tel) buttons.push(pill('Chiama ora', 'tel:' + links.tel, false));
  if (links.maps) buttons.push(pill('Apri Maps', links.maps, true));
  const place = [profile.address, profile.city].filter(Boolean).join(', ');
  const placeHtml = place
    ? '<div style="opacity:.75;font:14px/1.5 system-ui,-apple-system,sans-serif;margin-bottom:12px">' + esc(place) + '</div>'
    : '';
  const raw = profile.openingHours && profile.openingHours.raw ? profile.openingHours.raw : '';
  const hoursHtml = showHours && raw
    ? '<div data-brik-hours style="opacity:.75;font:14px/1.5 system-ui,-apple-system,sans-serif;margin-top:12px">Orari: ' + esc(raw) + '</div>'
    : '';
  const buttonsHtml = buttons.length
    ? '<div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center">' + buttons.join('') + '</div>'
    : '';
  return (
    '<section data-brik-contact-strip style="padding:28px 16px;text-align:center;border-top:1px solid currentColor;color:inherit">' +
    '<div style="font:600 17px/1.4 system-ui,-apple-system,sans-serif;margin-bottom:10px">Prenota o chiedi informazioni</div>' +
    placeHtml +
    buttonsHtml +
    hoursHtml +
    '</section>'
  );
}

function maybeAppendContactStrip(html: string, profile: PizzeriaBusinessProfile): string {
  if (/data-brik-contact-strip/.test(html)) return html; // non duplicare
  const links = {
    wa: waMeLink(profile.whatsapp),
    tel: profile.phone ? normalizePhoneForHref(profile.phone) : null,
    maps: profile.googleMapsUrl || null,
  };
  const hasActionable = !!(links.wa || links.tel || links.maps);
  const raw = profile.openingHours && profile.openingHours.raw ? profile.openingHours.raw : '';
  const hoursAlready = !!raw && /orari/i.test(html) && /\d{1,2}[:.]\d{2}/.test(html);
  const showHours = !!raw && !hoursAlready;
  // La strip nasce per dati azionabili (WhatsApp/telefono/Maps) o per gli orari.
  // Solo indirizzo/città non bastano (resta coerente con la Patch 3A).
  if (!hasActionable && !showHours) return html;
  const strip = buildContactStrip(profile, links, showHours);
  const i = html.search(/<\/body>/i);
  return i < 0 ? html + strip : html.slice(0, i) + strip + html.slice(i);
}

// ---------------------------------------------------------------------------
// Menu (sezione additiva dal profilo, solo categorie con item reali)
// ---------------------------------------------------------------------------

function buildMenuSection(menu: NonNullable<PizzeriaBusinessProfile['menu']>): string {
  const cats = menu.categories.filter((c) => Array.isArray(c.items) && c.items.length > 0);
  if (!cats.length) return '';
  const blocks = cats
    .map((c) => {
      const items = c.items
        .map((it) => {
          const price = it.price
            ? '<span style="white-space:nowrap;opacity:.85;font-weight:600">' + esc(it.price) + '</span>'
            : '';
          const desc = it.description
            ? '<div style="opacity:.7;font:14px/1.4 system-ui,-apple-system,sans-serif;margin-top:2px">' + esc(it.description) + '</div>'
            : '';
          return (
            '<li style="padding:8px 0;border-bottom:1px solid currentColor">' +
            '<div style="display:flex;justify-content:space-between;gap:14px;align-items:baseline">' +
            '<span style="font-weight:600">' + esc(it.name) + '</span>' + price + '</div>' + desc + '</li>'
          );
        })
        .join('');
      return (
        '<div style="margin-bottom:22px">' +
        '<h3 style="font:600 16px/1.3 system-ui,-apple-system,sans-serif;margin:0 0 8px;opacity:.9">' + esc(c.name) + '</h3>' +
        '<ul style="list-style:none;padding:0;margin:0">' + items + '</ul></div>'
      );
    })
    .join('');
  return (
    '<section data-brik-menu style="padding:32px 16px;max-width:680px;margin:0 auto;color:inherit">' +
    '<h2 style="font:700 22px/1.3 system-ui,-apple-system,sans-serif;text-align:center;margin:0 0 20px">Menu</h2>' +
    blocks +
    '</section>'
  );
}

function maybeAppendMenu(html: string, profile: PizzeriaBusinessProfile): string {
  if (/data-brik-menu/.test(html)) return html; // non duplicare
  const menu = profile.menu;
  if (!menu || !Array.isArray(menu.categories) || !menu.categories.some((c) => Array.isArray(c.items) && c.items.length > 0)) {
    return html; // nessun item reale → niente sezione
  }
  const section = buildMenuSection(menu);
  if (!section) return html;
  const i = html.search(/<\/body>/i);
  return i < 0 ? html + section : html.slice(0, i) + section + html.slice(i);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Applica il profilo pizzeria a una pagina pubblica. Conservativo e gated dai dati. */
export function applyPizzeriaProfileToPublicHtml(html: string, profile: PizzeriaBusinessProfile | undefined | null): string {
  if (!html || !profile) return html;
  let out = html;
  out = overrideContacts(out, profile);
  out = applyPrimaryCta(out, profile);
  out = maybeAppendMenu(out, profile); // menu sopra i contatti
  out = maybeAppendContactStrip(out, profile);
  return out;
}

/** Applica il profilo a tutte le pagine (per la catena di publish). No-op se il profilo manca. */
export function withPizzeriaProfile<T extends { html: string }>(pages: readonly T[], profile: PizzeriaBusinessProfile | undefined | null): T[] {
  if (!profile) return [...pages];
  return pages.map((p) => ({ ...p, html: applyPizzeriaProfileToPublicHtml(p.html, profile) }));
}
