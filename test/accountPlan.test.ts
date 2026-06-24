/**
 * B2 — gate account/siti pubblicati. Test deterministici (offline).
 * Lancio: npx tsx --test test/accountPlan.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canPublish } from '../src/server/accountStore.js';

test('canPublish: sotto il limite del piano -> consentito', () => {
  assert.equal(canPublish({ entitled: false, status: 'preview', publishedCount: 2, maxPublished: 3 }), true);
});

test('canPublish: al limite del piano -> bloccato', () => {
  assert.equal(canPublish({ entitled: false, status: 'preview', publishedCount: 3, maxPublished: 3 }), false);
});

test('canPublish: account nuovo (maxPublished 0) -> bloccato', () => {
  assert.equal(canPublish({ entitled: false, status: 'preview', publishedCount: 0, maxPublished: 0 }), false);
});

test('canPublish: sito entitled -> sempre consentito anche oltre il limite', () => {
  assert.equal(canPublish({ entitled: true, status: 'preview', publishedCount: 5, maxPublished: 3 }), true);
});

test('canPublish: ri-pubblicazione di un sito gia published -> consentito (gia nel conteggio)', () => {
  assert.equal(canPublish({ entitled: false, status: 'published', publishedCount: 3, maxPublished: 3 }), true);
});

test('canPublish: primo slot con piano 1 -> consentito', () => {
  assert.equal(canPublish({ entitled: false, status: 'preview', publishedCount: 0, maxPublished: 1 }), true);
});
