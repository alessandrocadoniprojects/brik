/**
 * Pizzeria Pack v1 — Patch 7: SEO locale base per pizzerie.
 *
 * Helper PURO: dal PizzeriaBusinessProfile costruisce title, meta description, OG e
 * un JSON-LD Restaurant, usando SOLO dati reali. Nessun campo viene inventato: address,
 * telefono, orari, città compaiono nei metadati solo se presenti nel profilo.
 *
 * L'aggancio all'HTML (`applyPizzeriaSeoToHtml` / `withPizzeriaSeo`) aggiorna i tag
 * esistenti senza duplicarli; è no-op se manca la SEO (cioè se non è una pizzeria).
 */

import type { PizzeriaBusinessProfile } from './pizzeriaProfile.js';

export interface PizzeriaLocalSeo {
  title: string;
  description: string;
  ogTitle?: string;
  ogDescription?: string;
  jsonLd?: Record<string, unknown>;
}

// --- Differenziante breve (solo da dati reali) ------------------------------

function differentiator(p: PizzeriaBusinessProfile): string | undefined {
  const s = new Set(p.strengths || []);
  const takeaway = !!(p.services && p.services.takeaway);
  switch (p.pizzeriaType) {
    case 'al-taglio':
      return takeaway ? 'Pizza al taglio e asporto' : 'Pizza al taglio';
    case 'gourmet':
      return 'Pizze signature e ingredienti selezionati';
    case 'pizza-birre-vini':
      return 'Pizza, birre e vini';
    case 'napoletana':
      if (s.has('forno-a-legna')) return 'Forno a legna';
      if (s.has('lunga-lievitazione')) return 'Impasto a lunga lievitazione';
      return 'Pizza napoletana';
    case 'contemporanea':
      if (s.has('forno-a-legna')) return 'Forno a legna';
      if (s.has('lunga-lievitazione')) return 'Impasto a lunga lievitazione';
      return 'Pizza contemporanea';
    case 'familiare':
      if (s.has('forno-a-legna')) return 'Forno a legna';
      return undefined; // niente di forte da affermare: non forziamo
    default:
      // generic o tipo assente: solo se c'è un punto forte reale
      if (s.has('forno-a-legna')) return 'Forno a legna';
      if (s.has('lunga-lievitazione')) return 'Impasto a lunga lievitazione';
      if (s.has('ingredienti-selezionati')) return 'Ingredienti selezionati';
      return undefined;
  }
}

/** Prefissa "Pizzeria " al nome, evitando il raddoppio se il nome lo contiene già. */
function withPizzeriaPrefix(name: string): string {
  return /\bpizzeri/i.test(name) ? name : 'Pizzeria ' + name;
}

// --- JSON-LD Restaurant -----------------------------------------------------

function buildJsonLd(p: PizzeriaBusinessProfile, siteUrl: string | undefined, name: string | undefined): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    servesCuisine: 'Pizza',
  };
  if (name) ld.name = name;
  if (siteUrl) ld.url = siteUrl;
  if (p.phone) ld.telephone = p.phone;
  if (p.address) {
    ld.address = {
      '@type': 'PostalAddress',
      streetAddress: p.address,
      ...(p.city ? { addressLocality: p.city } : {}),
    };
  }
  if (p.openingHours && p.openingHours.raw) ld.openingHours = p.openingHours.raw;
  const sameAs = [p.googleMapsUrl, p.instagramUrl, p.facebookUrl].filter((u): u is string => !!u);
  if (sameAs.length) ld.sameAs = sameAs;
  return ld;
}

// --- Helper principale ------------------------------------------------------

/**
 * Costruisce i metadati SEO locali per una pizzeria. Ritorna undefined se il profilo
 * manca (cioè se non è una pizzeria): in quel caso nessuna SEO pizzeria viene prodotta.
 */
export function buildPizzeriaLocalSeo(profile: PizzeriaBusinessProfile | undefined | null, siteUrl?: string): PizzeriaLocalSeo | undefined {
  if (!profile) return undefined;
  const name = profile.businessName && profile.businessName.trim() ? profile.businessName.trim() : undefined;
  const city = profile.city && profile.city.trim() ? profile.city.trim() : undefined;
  const diff = differentiator(profile);

  let title: string;
  if (name && city) title = `${withPizzeriaPrefix(name)} a ${city}${diff ? ' | ' + diff : ''}`;
  else if (name) title = `${withPizzeriaPrefix(name)}${diff ? ' | ' + diff : ''}`;
  else title = 'Sito pizzeria';

  const punto = diff ? diff.charAt(0).toLowerCase() + diff.slice(1) : undefined;
  let description: string;
  if (name && city) description = `Scopri ${name}, pizzeria a ${city}${punto ? ' con ' + punto : ''}. Menu, orari, prenotazioni e contatti online.`;
  else if (name) description = `Scopri ${name}, pizzeria${punto ? ' con ' + punto : ''}. Menu, orari, prenotazioni e contatti online.`;
  else description = 'Sito pizzeria con menu, orari, prenotazioni e contatti online.';

  const seo: PizzeriaLocalSeo = { title, description, ogTitle: title, ogDescription: description };
  seo.jsonLd = buildJsonLd(profile, siteUrl, name);
  return seo;
}

// --- Aggancio HTML (conservativo, senza duplicati) --------------------------

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function injectInHead(html: string, tag: string): string {
  const h = html.search(/<\/head>/i);
  if (h >= 0) return html.slice(0, h) + tag + html.slice(h);
  const b = html.search(/<body[\s>]/i);
  if (b >= 0) return html.slice(0, b) + tag + html.slice(b);
  return tag + html;
}

function upsertMeta(html: string, attr: 'name' | 'property', key: string, value: string): string {
  const re = new RegExp('<meta\\s+[^>]*' + attr + '\\s*=\\s*["\']' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\'][^>]*>', 'i');
  const tag = `<meta ${attr}="${key}" content="${esc(value)}">`;
  if (re.test(html)) return html.replace(re, tag);
  return injectInHead(html, tag);
}

/** Applica la SEO a una pagina pubblica: aggiorna title/description/OG e inserisce il JSON-LD una sola volta. */
export function applyPizzeriaSeoToHtml(html: string, seo: PizzeriaLocalSeo | undefined | null): string {
  if (!html || !seo) return html;
  let out = html;

  if (/<title>[\s\S]*?<\/title>/i.test(out)) out = out.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + esc(seo.title) + '</title>');
  else out = injectInHead(out, '<title>' + esc(seo.title) + '</title>');

  out = upsertMeta(out, 'name', 'description', seo.description);
  if (seo.ogTitle) out = upsertMeta(out, 'property', 'og:title', seo.ogTitle);
  if (seo.ogDescription) out = upsertMeta(out, 'property', 'og:description', seo.ogDescription);

  if (seo.jsonLd && !/data-brik-seo-jsonld/.test(out)) {
    const script = '<script type="application/ld+json" data-brik-seo-jsonld>' + JSON.stringify(seo.jsonLd) + '</script>';
    out = injectInHead(out, script);
  }
  return out;
}

/** Applica la SEO a tutte le pagine (per la catena di publish). No-op se la SEO manca. */
export function withPizzeriaSeo<T extends { html: string }>(pages: readonly T[], seo: PizzeriaLocalSeo | undefined | null): T[] {
  if (!seo) return [...pages];
  return pages.map((p) => ({ ...p, html: applyPizzeriaSeoToHtml(p.html, seo) }));
}
