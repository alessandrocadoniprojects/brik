/**
 * Test Fase 2.6 — compliance del generatore (prompt + CSS).
 * Deterministici e offline. Lancio: npx tsx --test test/generatorCompliance.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt } from '../src/adapters/anthropic/siteGenerator.js';
import { designCss } from '../src/adapters/anthropic/designSystem.js';

test('2.6/4: identità creative-studio vieta le emoji', () => {
  const p = systemPrompt('creative-studio').toLowerCase();
  assert.match(p, /vietato[^]*emoji/); // 'emoji' compare in un contesto di divieto
});

test('2.6/5: identità creative-studio vieta contatori/data-count e metriche finte', () => {
  const p = systemPrompt('creative-studio').toLowerCase();
  assert.match(p, /contatori animati e data-count/);
  assert.match(p, /metriche o statistiche inventate/);
});

test('2.6/5b: creative-studio rinforza punto di vista e lavori come prova', () => {
  const p = systemPrompt('creative-studio').toLowerCase();
  assert.match(p, /punto di vista/);
  assert.match(p, /lavori selezionati/);
});

test('2.6/6: CSS footer mobile protegge le email dallo spezzarsi male', () => {
  const css = designCss('creative-studio');
  // I link footer (incl. mailto/tel) usano break-word, non "anywhere": niente spezzature mid-dominio.
  assert.match(css, /a\[href\^="mailto"\]/);
  assert.match(css, /overflow-wrap:break-word/);
  // .foot (footer di creative-studio) rientra nelle regole mobile a colonna singola.
  assert.match(css, /@media \(max-width:600px\)\{\.foot \.grid/);
});

test('2.6/6b: la protezione vale anche per gli altri temi (footer condiviso)', () => {
  const css = designCss('editorial-luxury');
  assert.match(css, /a\[href\^="mailto"\]/);
  assert.match(css, /overflow-wrap:break-word/);
});
