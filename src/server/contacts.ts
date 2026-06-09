/**
 * Rende cliccabili EMAIL e TELEFONI nel testo visibile dei siti generati.
 *
 * Sicurezza anti-rotture: processa SOLO i nodi di testo, saltando tag, attributi,
 * <a> già esistenti, <head>, <script>, <style>. I telefoni vengono linkati solo se
 * iniziano con "+" (formato internazionale): un "+" non compare mai in P.IVA, anni o
 * prezzi, quindi niente falsi positivi. I telefoni senza "+" li gestisce il generatore.
 */

const EMAIL_RE = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const TEL_INTL_RE = /(\+\d[\d\s().\-]{6,}\d)/g;

// Blocchi da NON toccare: <a>…</a>, <head>…</head>, <script>…</script>, <style>…</style>, e qualsiasi tag.
const PROTECT_SPLIT =
  /(<a\b[\s\S]*?<\/a>|<head\b[\s\S]*?<\/head>|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<[^>]+>)/i;

function linkifyText(text: string): string {
  let out = text.replace(EMAIL_RE, (m) => '<a href="mailto:' + m + '">' + m + '</a>');
  out = out.replace(TEL_INTL_RE, (m) => {
    const tel = m.replace(/[^\d+]/g, '');
    if (tel.replace(/\D/g, '').length < 7) return m; // troppo corto per essere un numero
    return '<a href="tel:' + tel + '">' + m + '</a>';
  });
  return out;
}

export function linkifyContacts(html: string): string {
  if (!html) return html;
  // split con gruppo catturante: indici dispari = blocchi protetti, pari = testo.
  const parts = html.split(PROTECT_SPLIT);
  for (let i = 0; i < parts.length; i += 2) {
    const seg = parts[i];
    if (seg && (seg.indexOf('@') >= 0 || seg.indexOf('+') >= 0)) {
      parts[i] = linkifyText(seg);
    }
  }
  return parts.join('');
}

export function withContactLinks<T extends { html: string }>(pages: readonly T[]): T[] {
  return pages.map((p) => ({ ...p, html: linkifyContacts(p.html) }));
}
