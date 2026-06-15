/**
 * Pizzeria Pack v1 — Patch 1A. Test deterministici, offline.
 * Lancio: npx tsx --test test/publicSanitizer.test.ts
 *
 * Coprono i 7 casi richiesti: nome footer (id/business/fallback) e rimozione
 * dei segnaposto comuni dall'HTML pubblico, senza rompere l'HTML normale.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTechnicalName,
  publicBusinessName,
  sanitizePublicHtml,
} from '../src/server/publicSanitizer.js';

// --- 1) footer non usa il project id ---
test('footer: NON usa il project id tecnico', () => {
  assert.equal(isTechnicalName('site-abc123', { id: 'site-abc123' }), true);
  const name = publicBusinessName({ title: 'site-abc123', id: 'site-abc123', projectName: 'site-abc123' });
  assert.notEqual(name, 'site-abc123');
  assert.equal(name, 'La tua attività');
});

test('footer: riconosce id/slug tecnici anche senza contesto', () => {
  assert.equal(isTechnicalName('site-9f3k2a1'), true); // formato newId()
  assert.equal(isTechnicalName('Pizzeria Da Marco'), false);
  assert.equal(isTechnicalName('pizzeria'), false); // parola reale, NON tecnica
});

// --- 2) footer usa il business name quando disponibile ---
test('footer: usa il nome reale quando disponibile', () => {
  const name = publicBusinessName({ title: 'Pizzeria Da Marco', id: 'site-abc123', projectName: 'pizzeria-da-marco' });
  assert.equal(name, 'Pizzeria Da Marco');
});

test('footer: businessName ha priorità sul titolo', () => {
  const name = publicBusinessName({ businessName: 'Trattoria Vera', title: 'site-xyz', id: 'site-xyz' });
  assert.equal(name, 'Trattoria Vera');
});

// --- 3) footer usa il fallback "La tua attività" quando il nome non c'è ---
test('footer: fallback umano quando il nome manca o è tecnico', () => {
  assert.equal(publicBusinessName({ title: '', id: 'site-abc123' }), 'La tua attività');
  assert.equal(publicBusinessName({ title: null, id: 'site-abc123' }), 'La tua attività');
  assert.equal(publicBusinessName({ id: 'site-abc123' }), 'La tua attività');
});

// --- 4) info@example.com non resta nell'HTML pubblico ---
test('sanitizer: rimuove email placeholder dal testo e dai link', () => {
  const html = '<p>Scrivici a info@example.com</p>';
  const out = sanitizePublicHtml(html);
  assert.ok(!out.includes('info@example.com'), 'email placeholder rimasta');

  const link = '<a href="mailto:info@example.com">scrivici</a>';
  const outLink = sanitizePublicHtml(link);
  assert.ok(!outLink.includes('example.com'), 'href placeholder rimasto');
  assert.ok(outLink.includes('scrivici'), 'testo reale del link va conservato');
  assert.ok(!/<a\b/i.test(outLink), 'il link a placeholder va scollegato');
});

// --- 5) 045 000 0000 non resta nell'HTML pubblico ---
test('sanitizer: rimuove telefoni placeholder', () => {
  assert.ok(!sanitizePublicHtml('<p>Chiama 045 000 0000</p>').includes('045 000 0000'));
  assert.ok(!sanitizePublicHtml('<p>Tel: 000 000 0000</p>').includes('000 000 0000'));
  assert.ok(!sanitizePublicHtml('<p>123 456 7890</p>').includes('123 456 7890'));
  const telLink = '<a href="tel:0450000000">Chiamaci</a>';
  const out = sanitizePublicHtml(telLink);
  assert.ok(out.includes('Chiamaci'), 'testo reale conservato');
  assert.ok(!/<a\b/i.test(out), 'link a numero finto scollegato');
});

// --- 6) Lorem ipsum non resta nell'HTML pubblico ---
test('sanitizer: rimuove lorem ipsum', () => {
  const html = '<p>Lorem ipsum dolor sit amet consectetur.</p>';
  const out = sanitizePublicHtml(html);
  assert.ok(!/lorem ipsum/i.test(out), 'lorem ipsum rimasto');
  assert.ok(out.includes('<p>') && out.includes('</p>'), 'i tag restano intatti');
});

test('sanitizer: rimuove altri segnaposto noti', () => {
  assert.ok(!sanitizePublicHtml('<p>Via Esempio 12</p>').includes('Via Esempio'));
  assert.ok(!sanitizePublicHtml('<h1>Nome Pizzeria</h1>').includes('Nome Pizzeria'));
  assert.ok(!sanitizePublicHtml('<p>La tua pizzeria</p>').includes('La tua pizzeria'));
  assert.ok(!sanitizePublicHtml('<p>www.example.com</p>').includes('example.com'));
  assert.ok(!sanitizePublicHtml('<footer>site-abc123</footer>').includes('site-abc123'));
});

// --- 7) il sanitizer NON rompe HTML normale ---
test('sanitizer: HTML reale resta identico', () => {
  const real = '<header><h1>Pizzeria Da Marco</h1></header>'
    + '<p>Forno a legna dal 1980. Chiama il <a href="tel:+390451234567">045 123 4567</a>.</p>'
    + '<p>Scrivici a marco@pizzeriadamarco.it · Via Mazzini 14, Verona</p>'
    + '<a href="https://maps.google.com/?q=Via+Mazzini+14+Verona">Mappa</a>';
  const out = sanitizePublicHtml(real);
  assert.equal(out, real, 'HTML reale non deve essere alterato');
});

test('sanitizer: numeri e indirizzi reali non vengono toccati', () => {
  assert.ok(sanitizePublicHtml('<p>+39 045 8012345</p>').includes('+39 045 8012345'));
  assert.ok(sanitizePublicHtml('<p>Via Roma 1</p>').includes('Via Roma 1')); // potrebbe essere reale: non si tocca
  assert.equal(sanitizePublicHtml(''), '');
});
