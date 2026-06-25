/**
 * B3 — derivazione maxPublished dallo stato subscription Stripe. Offline.
 * Lancio: npx tsx --test test/stripeWebhook.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxPublishedForSubscription } from '../src/server/accountStore.js';

const MAP = { price_base: 3, price_plus: 10, price_pro: 30 };

test('sub active su price base -> 3', () => {
  assert.equal(maxPublishedForSubscription({ eventType: 'customer.subscription.created', status: 'active', priceId: 'price_base', priceToMax: MAP }), 3);
});

test('sub active su price plus -> 10', () => {
  assert.equal(maxPublishedForSubscription({ eventType: 'customer.subscription.updated', status: 'active', priceId: 'price_plus', priceToMax: MAP }), 10);
});

test('subscription.deleted -> 0', () => {
  assert.equal(maxPublishedForSubscription({ eventType: 'customer.subscription.deleted', status: 'active', priceId: 'price_base', priceToMax: MAP }), 0);
});

test('status canceled -> 0', () => {
  assert.equal(maxPublishedForSubscription({ eventType: 'customer.subscription.updated', status: 'canceled', priceId: 'price_base', priceToMax: MAP }), 0);
});

test('status unpaid -> 0', () => {
  assert.equal(maxPublishedForSubscription({ eventType: 'customer.subscription.updated', status: 'unpaid', priceId: 'price_base', priceToMax: MAP }), 0);
});

test('status incomplete (pagamento non confermato) -> 0', () => {
  assert.equal(maxPublishedForSubscription({ eventType: 'customer.subscription.updated', status: 'incomplete', priceId: 'price_base', priceToMax: MAP }), 0);
});

test('status past_due (grace, Stripe ritenta) -> mantiene 3', () => {
  assert.equal(maxPublishedForSubscription({ eventType: 'customer.subscription.updated', status: 'past_due', priceId: 'price_base', priceToMax: MAP }), 3);
});

test('status trialing -> concede il piano', () => {
  assert.equal(maxPublishedForSubscription({ eventType: 'customer.subscription.created', status: 'trialing', priceId: 'price_pro', priceToMax: MAP }), 30);
});

test('price sconosciuto -> 0', () => {
  assert.equal(maxPublishedForSubscription({ eventType: 'customer.subscription.updated', status: 'active', priceId: 'price_ignoto', priceToMax: MAP }), 0);
});
