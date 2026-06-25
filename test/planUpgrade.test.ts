/**
 * plan-upgrade — selezione del tier superiore (nextTier). Pura, offline.
 * Lancio: npx tsx --test test/planUpgrade.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTier, type Tier } from '../src/server/accountStore.js';

const LADDER: Tier[] = [
  { price: 'p_base', max: 3 },
  { price: 'p_plus', max: 10 },
  { price: 'p_pro', max: 30 },
];

test('nextTier: dal Base (3) propone il Plus (10)', () => {
  assert.deepEqual(nextTier(3, LADDER), { price: 'p_plus', max: 10 });
});

test('nextTier: dal Plus (10) propone il Pro (30)', () => {
  assert.deepEqual(nextTier(10, LADDER), { price: 'p_pro', max: 30 });
});

test('nextTier: dal Pro (30, top) ritorna null', () => {
  assert.equal(nextTier(30, LADDER), null);
});

test('nextTier: senza piano (0) propone il primo tier (Base 3)', () => {
  assert.deepEqual(nextTier(0, LADDER), { price: 'p_base', max: 3 });
});

test('nextTier: con maxPublished tra due tier (5) propone il primo sopra (Plus 10)', () => {
  assert.deepEqual(nextTier(5, LADDER), { price: 'p_plus', max: 10 });
});

test('nextTier: ladder non ordinata viene comunque gestita (ordina internamente)', () => {
  const shuffled: Tier[] = [
    { price: 'p_pro', max: 30 },
    { price: 'p_base', max: 3 },
    { price: 'p_plus', max: 10 },
  ];
  assert.deepEqual(nextTier(3, shuffled), { price: 'p_plus', max: 10 });
});

test('nextTier: ladder con un solo tier, già al massimo → null', () => {
  assert.equal(nextTier(3, [{ price: 'p_base', max: 3 }]), null);
});
