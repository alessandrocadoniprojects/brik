/**
 * Test Fase 3 — Step 1: cleanup deterministico per la preview.
 * Puri, offline, deterministici. Lancio: npx tsx --test test/cleanupHtml.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupHtml, cleanupPages } from '../src/project/cleanupHtml.js';

test('1: cleanupHtml rimuove le emoji', () => {
  const out = cleanupHtml('<h1>Benvenuto \u{1F44B}\u{1F3AF}</h1><p>Ottimo \u2728</p>');
  assert.doesNotMatch(out, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  assert.match(out, /<h1>Benvenuto\s*<\/h1>/);
  assert.match(out, /Ottimo/);
});

test('1b: cleanupHtml NON rimuove frecce e punteggiatura tipografica del design system', () => {
  const html = '<a class="tlink">Guarda i lavori <span class="arr">\u2192</span></a><span class="cap">A \u00b7 B \u2014 C \u00d7 D</span>';
  const out = cleanupHtml(html);
  assert.match(out, /\u2192/);   // freccia preservata
  assert.match(out, /\u00b7/);   // middot
  assert.match(out, /\u2014/);   // em dash
  assert.match(out, /\u00d7/);   // moltiplicazione
});

test('2: cleanupHtml rimuove data-count lasciando il numero statico', () => {
  const html = '<div class="n"><span data-count>240</span><span class="plus">+</span></div>';
  const out = cleanupHtml(html);
  assert.doesNotMatch(out, /data-count/);
  assert.match(out, /<span>240<\/span>/);            // numero statico preservato
  assert.match(out, /<span class="plus">\+<\/span>/); // resto del markup intatto
});

test('2b: rimuove data-count anche con valore e su più occorrenze', () => {
  const html = '<span data-count="240">240</span> e <span data-count>70000</span>';
  const out = cleanupHtml(html);
  assert.doesNotMatch(out, /data-count/);
  assert.match(out, /<span>240<\/span>/);
  assert.match(out, /<span>70000<\/span>/);
});

test('3: cleanupHtml è idempotente', () => {
  const html = '<h1>Ciao \u{1F60A}</h1><span data-count>12</span>';
  const once = cleanupHtml(html);
  const twice = cleanupHtml(once);
  assert.equal(once, twice);
});

test('4: cleanupHtml non rompe il markup intorno', () => {
  const html = '<section class="hero" data-reveal id="x"><h1 class="title">Studio \u{1F3E2}</h1><img data-brik-img="office detail" alt="ufficio"><span data-count>15</span> anni</section>';
  const out = cleanupHtml(html);
  // attributi vicini intatti
  assert.match(out, /<section class="hero" data-reveal id="x">/);
  assert.match(out, /class="title"/);
  assert.match(out, /data-brik-img="office detail"/);
  assert.match(out, /alt="ufficio"/);
  // solo emoji e data-count rimossi
  assert.doesNotMatch(out, /data-count/);
  assert.doesNotMatch(out, /[\u{1F000}-\u{1FAFF}]/u);
  assert.match(out, /<span>15<\/span> anni/);
});

test('cleanupPages applica il cleanup a tutte le pagine e preserva gli altri campi', () => {
  const pages = [
    { route: '/', html: '<h1>Home \u{1F525}</h1><span data-count>9</span>' },
    { route: '/contatti', html: '<p>Scrivici \u2709</p>' },
  ];
  const out = cleanupPages(pages);
  assert.equal(out[0]!.route, '/');
  assert.doesNotMatch(out[0]!.html, /data-count|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  assert.doesNotMatch(out[1]!.html, /[\u{2600}-\u{27BF}]/u);
  assert.match(out[0]!.html, /<span>9<\/span>/);
});
