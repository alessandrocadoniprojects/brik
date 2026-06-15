/**
 * Pizzeria Pack v1 — Patch 5. Test deterministici, offline.
 * Lancio: npx tsx --test test/pizzeriaVerticalIntake.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planPizzeriaIntake,
  applyPizzeriaIntakeAnswers,
  ensurePizzeriaProfile,
} from '../src/server/pizzeriaVerticalIntake.js';
import type { PizzeriaBusinessProfile } from '../src/server/pizzeriaProfile.js';

const ids = (plan: { questions: { id: string }[] }) => plan.questions.map((q) => q.id);

// 1) pizzeria attiva intake
test('1) descrizione pizzeria → intake attivo', () => {
  const plan = planPizzeriaIntake({ description: 'Pizzeria napoletana con forno a legna' });
  assert.equal(plan.active, true);
  assert.ok(plan.questions.length > 0);
});

// 2) ristorante da solo non attiva
test('2) ristorante generico → non attivo', () => {
  assert.equal(planPizzeriaIntake({ description: 'Ristorante di pesce sul lungomare' }).active, false);
  assert.equal(planPizzeriaIntake({ description: 'Trattoria tipica toscana' }).active, false);
});

// 3) businessName già presente → non chiede nome
test('3) businessName presente → niente domanda nome', () => {
  const plan = planPizzeriaIntake({ description: 'una pizzeria', profile: { businessName: 'Da Marco' } });
  assert.ok(!ids(plan).includes('name'));
});

// 4) pizzeriaType già presente → non chiede tipo
test('4) pizzeriaType presente → niente domanda tipo', () => {
  const plan = planPizzeriaIntake({ description: 'una pizzeria', profile: { pizzeriaType: 'napoletana' } });
  assert.ok(!ids(plan).includes('type'));
  // ma 'generic' va comunque chiesto
  const plan2 = planPizzeriaIntake({ description: 'una pizzeria', profile: { pizzeriaType: 'generic' } });
  assert.ok(ids(plan2).includes('type'));
});

// 5) "Al taglio / asporto" salva al-taglio e takeaway
test('5) tipo al taglio → al-taglio + takeaway', () => {
  const { profile } = applyPizzeriaIntakeAnswers({ pizzeriaType: 'generic' }, { type: 'Al taglio / asporto' });
  assert.equal(profile.pizzeriaType, 'al-taglio');
  assert.equal(profile.services?.takeaway, true);
});

// 6) CTA WhatsApp/chiama coerente
test('6) CTA "Chiamare / WhatsApp" coerente col profilo', () => {
  const withWa = applyPizzeriaIntakeAnswers({ whatsapp: '+393331234567' }, { cta: 'Chiamare / WhatsApp' });
  assert.equal(withWa.profile.primaryCta, 'whatsapp');
  const noWa = applyPizzeriaIntakeAnswers({}, { cta: 'Chiamare / WhatsApp' });
  assert.equal(noWa.profile.primaryCta, 'chiama');
  // asporto attiva anche takeaway
  const asp = applyPizzeriaIntakeAnswers({}, { cta: 'Ordinare asporto' });
  assert.equal(asp.profile.primaryCta, 'asporto');
  assert.equal(asp.profile.services?.takeaway, true);
});

// 7) foto aggiorna photos
test('7) risposta foto → photos', () => {
  const { profile } = applyPizzeriaIntakeAnswers({}, { photos: ['Pizze', 'Forno'] });
  assert.equal(profile.photos?.hasRealPizzaPhotos, true);
  assert.equal(profile.photos?.hasRealOvenPhotos, true);
  // "No" non imposta nulla
  const none = applyPizzeriaIntakeAnswers({}, { photos: ['No'] });
  assert.equal(none.profile.photos, undefined);
});

// 8) materials con menuText evita domanda prodotti/menu
test('8) materials + menuText → niente domanda prodotti', () => {
  const plan = planPizzeriaIntake({
    description: 'una pizzeria',
    startingPoint: { mode: 'materials', materials: { menuText: 'Margherita 8, Diavola 10' } },
  });
  assert.ok(!ids(plan).includes('products'));
});

// 9) guided-from-zero genera più domande
test('9) guided-from-zero → più domande di existing-site', () => {
  const guided = planPizzeriaIntake({ description: 'una pizzeria', startingPoint: { mode: 'guided-from-zero' } });
  const existing = planPizzeriaIntake({ description: 'una pizzeria', startingPoint: { mode: 'existing-site' } });
  assert.ok(guided.questions.length > existing.questions.length);
});

// 10) profilo creato solo se pizzeria
test('10) ensurePizzeriaProfile crea solo per pizzeria', () => {
  assert.ok(ensurePizzeriaProfile('Pizzeria Da Marco, forno a legna'));
  assert.equal(ensurePizzeriaProfile('Ristorante di pesce'), undefined);
  // profilo esistente viene restituito invariato
  const existing: PizzeriaBusinessProfile = { businessName: 'X', pizzeriaType: 'gourmet' };
  assert.equal(ensurePizzeriaProfile('qualsiasi cosa', existing), existing);
});

// extra: numero domande entro il tetto 8
test('extra) mai più di 8 domande', () => {
  const plan = planPizzeriaIntake({ description: 'una pizzeria', startingPoint: { mode: 'guided-from-zero' } });
  assert.ok(plan.questions.length <= 8);
});

test('11) stylePreset verticale viene persistito solo se canonico', () => {
  const valid = applyPizzeriaIntakeAnswers({ pizzeriaType: 'generic' }, { stylePreset: 'romana-pinsa-focaccia' });
  assert.equal(valid.profile.stylePreset, 'romana-pinsa-focaccia');
  const invalid = applyPizzeriaIntakeAnswers({ pizzeriaType: 'generic' }, { stylePreset: 'preset-inesistente' as never });
  assert.equal(invalid.profile.stylePreset, undefined);
});
