/**
 * Intake: lo STILE proposto e DETERMINISTICO (da recommendedThemeFromDescription),
 * non deciso liberamente dall'LLM. L'LLM resta solo per le domande.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, type LLMProvider } from '../src/core/index.js';
import { planIntakeQuestions } from '../src/intake/intakeQuestions.js';

// L'LLM propone editorial-luxury di proposito: deve essere IGNORATO per lo stile.
function fakeLlm(): LLMProvider {
  return {
    name: 'fake',
    complete: async () =>
      ok({ text: '{"recommendedStyle":"editorial-luxury","questions":[{"question":"Come si chiama l\'attivita?","options":["Lo scrivo io"]}]}' }),
  };
}

test('intake: toelettatura cani -> scandinavian-service (ignora editorial-luxury dell LLM)', async () => {
  const r = await planIntakeQuestions({ description: 'Negozio di toelettatura cani e gatti, lavaggio e tolettatura', llm: fakeLlm() });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.recommendedStyle, 'scandinavian-service');
    assert.ok(r.value.questions.length > 0); // le domande dell LLM restano
  }
});

test('intake: pizzeria di quartiere -> warm-bistro solo con BRIK_THEME_BISTRO=on', async () => {
  const prev = process.env.BRIK_THEME_BISTRO;
  delete process.env.BRIK_THEME_BISTRO;
  const off = await planIntakeQuestions({ description: 'Pizzeria di quartiere a Napoli, forno a legna', llm: fakeLlm() });
  assert.equal(off.ok, true);
  if (off.ok) assert.equal(off.value.recommendedStyle, 'scandinavian-service');
  process.env.BRIK_THEME_BISTRO = 'on';
  const on = await planIntakeQuestions({ description: 'Pizzeria di quartiere a Napoli, forno a legna', llm: fakeLlm() });
  assert.equal(on.ok, true);
  if (on.ok) assert.equal(on.value.recommendedStyle, 'warm-bistro');
  if (prev == null) delete process.env.BRIK_THEME_BISTRO; else process.env.BRIK_THEME_BISTRO = prev;
});

test('intake: ristorante gourmet con chef -> editorial-luxury', async () => {
  const r = await planIntakeQuestions({ description: 'Ristorante gourmet con chef stellato e menu degustazione', llm: fakeLlm() });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.recommendedStyle, 'editorial-luxury');
});
