/**
 * Pizzeria Pack v1 — Patch 7. Test deterministici, offline.
 * Lancio: npx tsx --test test/pizzeriaLocalSeo.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPizzeriaLocalSeo, applyPizzeriaSeoToHtml } from '../src/server/pizzeriaLocalSeo.js';
import type { PizzeriaBusinessProfile } from '../src/server/pizzeriaProfile.js';

// 1) nome+città → title locale
test('1) nome+città → title locale', () => {
  const seo = buildPizzeriaLocalSeo({ pizzeriaType: 'napoletana', businessName: 'Da Marco', city: 'Verona', strengths: ['forno-a-legna'] })!;
  assert.equal(seo.title, 'Pizzeria Da Marco a Verona | Forno a legna');
  assert.match(seo.description, /Scopri Da Marco, pizzeria a Verona con forno a legna/);
});

// 2) senza città non inventa città
test('2) senza città → niente città', () => {
  const seo = buildPizzeriaLocalSeo({ pizzeriaType: 'napoletana', businessName: 'Da Marco', strengths: ['forno-a-legna'] })!;
  assert.equal(seo.title, 'Pizzeria Da Marco | Forno a legna');
  assert.ok(!/ a undefined| a \|/.test(seo.title));
  assert.ok(!/pizzeria a /.test(seo.description), 'description senza città');
});

// 3) senza nome non usa project id, usa fallback prudente
test('3) senza nome → fallback, mai project id', () => {
  const seo = buildPizzeriaLocalSeo({ pizzeriaType: 'napoletana' })!;
  assert.equal(seo.title, 'Sito pizzeria');
  assert.equal(seo.description, 'Sito pizzeria con menu, orari, prenotazioni e contatti online.');
  assert.ok(!/site-/.test(seo.title) && !/undefined/.test(seo.title));
});

// 4) al-taglio + asporto → differenziante coerente
test('4) al-taglio + asporto → differenziante', () => {
  const seo = buildPizzeriaLocalSeo({ pizzeriaType: 'al-taglio', businessName: 'Al Volo', city: 'Milano', services: { takeaway: true } })!;
  assert.match(seo.title, /Pizza al taglio e asporto/);
});

// 5) gourmet → differenziante premium, non luxury-noir
test('5) gourmet → premium senza luxury-noir', () => {
  const seo = buildPizzeriaLocalSeo({ pizzeriaType: 'gourmet', businessName: 'Levante', city: 'Roma' })!;
  assert.match(seo.title, /signature|selezionat/i);
  assert.ok(!/luxury|noir/i.test(seo.title) && !/luxury|noir/i.test(seo.description));
});

// 6) JSON-LD contiene Restaurant e servesCuisine Pizza
test('6) JSON-LD Restaurant/Pizza', () => {
  const seo = buildPizzeriaLocalSeo({ pizzeriaType: 'napoletana', businessName: 'Da Marco' }, 'https://damarco.it')!;
  assert.ok(seo.jsonLd);
  assert.equal(seo.jsonLd!['@type'], 'Restaurant');
  assert.equal(seo.jsonLd!.servesCuisine, 'Pizza');
  assert.equal(seo.jsonLd!.url, 'https://damarco.it');
  assert.equal(seo.jsonLd!.name, 'Da Marco');
});

// 7) JSON-LD senza telefono se assente
test('7) JSON-LD niente telephone se assente', () => {
  const noTel = buildPizzeriaLocalSeo({ pizzeriaType: 'napoletana', businessName: 'X' })!;
  assert.equal(noTel.jsonLd!.telephone, undefined);
  const withTel = buildPizzeriaLocalSeo({ pizzeriaType: 'napoletana', businessName: 'X', phone: '+390458012345' })!;
  assert.equal(withTel.jsonLd!.telephone, '+390458012345');
});

// 8) JSON-LD senza address se assente
test('8) JSON-LD niente PostalAddress se assente', () => {
  const noAddr = buildPizzeriaLocalSeo({ pizzeriaType: 'napoletana', businessName: 'X', city: 'Verona' })!;
  assert.equal(noAddr.jsonLd!.address, undefined, 'solo city non crea PostalAddress');
  const withAddr = buildPizzeriaLocalSeo({ pizzeriaType: 'napoletana', businessName: 'X', address: 'Via Roma 1', city: 'Verona' })!;
  const addr = withAddr.jsonLd!.address as Record<string, unknown>;
  assert.equal(addr['@type'], 'PostalAddress');
  assert.equal(addr.streetAddress, 'Via Roma 1');
  assert.equal(addr.addressLocality, 'Verona');
});

// 9) HTML injection non duplica title/meta/jsonLd
test('9) injection idempotente', () => {
  const seo = buildPizzeriaLocalSeo({ pizzeriaType: 'napoletana', businessName: 'Da Marco', city: 'Verona' }, 'https://damarco.it')!;
  const html = '<html><head><title>Vecchio</title><meta name="description" content="vecchia"></head><body>x</body></html>';
  const once = applyPizzeriaSeoToHtml(html, seo);
  assert.equal((once.match(/<title>/gi) || []).length, 1, 'un solo title');
  assert.equal((once.match(/name="description"/gi) || []).length, 1, 'una sola description');
  assert.ok(once.includes('Pizzeria Da Marco a Verona'));
  assert.ok(!once.includes('Vecchio') && !once.includes('vecchia'));
  const twice = applyPizzeriaSeoToHtml(once, seo);
  assert.equal((twice.match(/<title>/gi) || []).length, 1);
  assert.equal((twice.match(/name="description"/gi) || []).length, 1);
  assert.equal((twice.match(/data-brik-seo-jsonld/gi) || []).length, 1, 'un solo JSON-LD');
});

// 10) non-pizzeria / profilo assente → nessuna SEO
test('10) profilo assente → undefined', () => {
  assert.equal(buildPizzeriaLocalSeo(undefined), undefined);
  assert.equal(buildPizzeriaLocalSeo(null), undefined);
  const html = '<html><head><title>X</title></head><body></body></html>';
  assert.equal(applyPizzeriaSeoToHtml(html, undefined), html, 'HTML invariato senza SEO');
});
