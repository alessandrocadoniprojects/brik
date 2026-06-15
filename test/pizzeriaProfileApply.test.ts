/**
 * Pizzeria Pack v1 — Patch 3A. Test deterministici, offline.
 * Lancio: npx tsx --test test/pizzeriaProfileApply.test.ts
 *
 * Coprono gli 11 casi richiesti: no-op senza profilo, link wa.me/tel, rifiuto
 * placeholder, override contatti, trasformazione CTA, niente duplicati, e
 * compatibilità con il sanitizer della Patch 1A.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPizzeriaProfileToPublicHtml,
  normalizePhoneForHref,
} from '../src/server/pizzeriaApply.js';
import { sanitizePublicHtml } from '../src/server/publicSanitizer.js';
import type { PizzeriaBusinessProfile } from '../src/server/pizzeriaProfile.js';

const BODY = (inner: string) => '<html><body>' + inner + '</body></html>';

// 1) non-pizzeria o profilo assente non cambia HTML
test('1) profilo assente: HTML invariato', () => {
  const html = BODY('<a href="#">Prenota</a>');
  assert.equal(applyPizzeriaProfileToPublicHtml(html, undefined), html);
  assert.equal(applyPizzeriaProfileToPublicHtml(html, null), html);
});

// 2) WhatsApp valido (internazionale) genera link wa.me
test('2) WhatsApp internazionale → wa.me', () => {
  const profile: PizzeriaBusinessProfile = { primaryCta: 'whatsapp', whatsapp: '+39 333 1234567' };
  const out = applyPizzeriaProfileToPublicHtml(BODY('<a href="#">Contattaci</a>'), profile);
  assert.ok(out.includes('https://wa.me/393331234567'), 'link wa.me atteso');
  assert.ok(out.includes('Scrivi su WhatsApp'));
});

// 3) telefono valido genera link tel:
test('3) telefono → tel:', () => {
  const profile: PizzeriaBusinessProfile = { primaryCta: 'chiama', phone: '+39 045 8012345' };
  const out = applyPizzeriaProfileToPublicHtml(BODY('<a href="#">Prenota</a>'), profile);
  assert.ok(out.includes('href="tel:+390458012345"'), 'href tel atteso');
  assert.ok(out.includes('Chiama ora'));
});

// 4) numero placeholder non genera link
test('4) numero placeholder → niente link', () => {
  assert.equal(normalizePhoneForHref('045 000 0000'), null);
  assert.equal(normalizePhoneForHref('0000000000'), null);
  assert.equal(normalizePhoneForHref('1234567890'), null);
  const profile: PizzeriaBusinessProfile = { primaryCta: 'whatsapp', whatsapp: '000 000 0000' };
  const out = applyPizzeriaProfileToPublicHtml(BODY('<a href="#">Prenota</a>'), profile);
  assert.ok(!out.includes('wa.me'), 'nessun wa.me da numero placeholder');
  assert.ok(!out.includes('data-brik-contact-strip'), 'nessuna strip senza dati azionabili');
});

// 5) email placeholder sostituita se profile.email esiste
test('5) email placeholder → email reale', () => {
  const profile: PizzeriaBusinessProfile = { email: 'ciao@damarco.it' };
  const out = applyPizzeriaProfileToPublicHtml(BODY('<p>Scrivici a info@example.com</p><a href="mailto:info@example.com">mail</a>'), profile);
  assert.ok(!out.includes('example.com'), 'placeholder email rimosso');
  assert.ok(out.includes('ciao@damarco.it'));
  assert.ok(out.includes('mailto:ciao@damarco.it'));
});

// 6) telefono placeholder sostituito se profile.phone esiste
test('6) telefono placeholder → numero reale', () => {
  const profile: PizzeriaBusinessProfile = { phone: '045 8012345' };
  const out = applyPizzeriaProfileToPublicHtml(BODY('<p>Chiama 045 000 0000</p>'), profile);
  assert.ok(!out.includes('045 000 0000'));
  assert.ok(out.includes('045 8012345'));
});

// 7) primaryCta whatsapp + whatsapp → "Scrivi su WhatsApp"
test('7) CTA WhatsApp', () => {
  const profile: PizzeriaBusinessProfile = { primaryCta: 'whatsapp', whatsapp: '+393331234567' };
  const out = applyPizzeriaProfileToPublicHtml(BODY('<a class="btn" href="#prenota">Prenota ora</a>'), profile);
  assert.ok(out.includes('Scrivi su WhatsApp'));
  assert.ok(out.includes('https://wa.me/393331234567'));
  assert.ok(!/>Prenota ora</.test(out), 'il testo generico è stato sostituito');
});

// 8) primaryCta chiama + phone → "Chiama ora"
test('8) CTA Chiama', () => {
  const profile: PizzeriaBusinessProfile = { primaryCta: 'chiama', phone: '+390458012345' };
  const out = applyPizzeriaProfileToPublicHtml(BODY('<a href="#">Contattaci</a>'), profile);
  assert.ok(out.includes('Chiama ora'));
  assert.ok(out.includes('href="tel:+390458012345"'));
});

// 9) primaryCta maps + googleMapsUrl → "Apri Maps"
test('9) CTA Maps', () => {
  const profile: PizzeriaBusinessProfile = { primaryCta: 'maps', googleMapsUrl: 'https://maps.google.com/?cid=123' };
  const out = applyPizzeriaProfileToPublicHtml(BODY('<a href="#">Prenota</a>'), profile);
  assert.ok(out.includes('Apri Maps'));
  assert.ok(out.includes('maps.google.com/?cid=123'));
});

// 10) non duplica contact strip se già presente
test('10) niente strip duplicata', () => {
  const profile: PizzeriaBusinessProfile = { primaryCta: 'whatsapp', whatsapp: '+393331234567' };
  const once = applyPizzeriaProfileToPublicHtml(BODY('<p>x</p>'), profile);
  const occ1 = (once.match(/data-brik-contact-strip/g) || []).length;
  assert.equal(occ1, 1, 'una sola strip');
  const twice = applyPizzeriaProfileToPublicHtml(once, profile);
  const occ2 = (twice.match(/data-brik-contact-strip/g) || []).length;
  assert.equal(occ2, 1, 'nessuna duplicazione su riapplicazione');
});

// 11) sanitizer 1A resta compatibile (apply → sanitize)
test('11) compatibile con sanitizer 1A', () => {
  // profilo SENZA email: il placeholder resta e deve essere rimosso dal sanitizer
  const profile: PizzeriaBusinessProfile = { phone: '045 8012345' };
  const applied = applyPizzeriaProfileToPublicHtml(BODY('<p>info@example.com — Chiama 045 000 0000</p>'), profile);
  const sanitized = sanitizePublicHtml(applied);
  assert.ok(!sanitized.includes('example.com'), 'email placeholder rimossa a valle dal sanitizer');
  assert.ok(!sanitized.includes('045 000 0000'), 'telefono placeholder sostituito');
  assert.ok(sanitized.includes('045 8012345'), 'numero reale presente');
  // e un sito reale non viene toccato da nessuno dei due
  const real = BODY('<h1>Pizzeria Da Marco</h1><a href="tel:+390458012345">045 801 2345</a>');
  assert.equal(sanitizePublicHtml(applyPizzeriaProfileToPublicHtml(real, { city: 'Verona' })), real);
});

// extra: numero nazionale senza prefisso NON genera wa.me (no prefissi inventati)
test('extra) numero nazionale senza prefisso → niente wa.me', () => {
  const profile: PizzeriaBusinessProfile = { primaryCta: 'whatsapp', whatsapp: '3331234567' };
  const out = applyPizzeriaProfileToPublicHtml(BODY('<a href="#">Prenota</a>'), profile);
  assert.ok(!out.includes('wa.me'), 'senza country code niente wa.me');
});
