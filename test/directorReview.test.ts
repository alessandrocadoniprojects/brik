/**
 * Test deterministici del direttore creativo multi-asse (Step 5).
 * Offline: l'LLM è finto e restituisce JSON pilotato. Nessuna rete.
 * Lancio: npx tsx --test test/directorReview.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, err, appError, type LLMProvider } from '../src/core/index.js';
import { reviewSite, type DirectorScores } from '../src/project/directorReview.js';

// LLM finto che risponde sempre con il testo dato (come fosse il modello).
function fakeLlm(text: string): LLMProvider {
  return { name: 'fake', complete: async () => ok({ text }) };
}
// LLM finto che fallisce, per testare il percorso best-effort.
function failingLlm(): LLMProvider {
  return { name: 'fake', complete: async () => err(appError('LLM_DOWN', 'giù', { retryable: true })) };
}

const FULL_SCORES = (n: number): DirectorScores => ({
  prestige: n,
  industry_fit: n,
  visual_hierarchy: n,
  restraint: n,
  conversion_clarity: n,
  anti_cliche: n,
  copy_quality: n,
  theme_alignment: n,
});

const HTML = '<html><body><h1>Ristorante</h1></body></html>';

test('verdetto positivo → pass, breakdown e decisione presenti', async () => {
  const json = JSON.stringify({ scores: FULL_SCORES(9), overall: 9, decision: 'pass', issues: [] });
  const v = await reviewSite({ llm: fakeLlm(json), business: 'Ristorante', homeHtml: HTML });
  assert.equal(v.pass, true);
  assert.equal(v.decision, 'pass');
  assert.equal(v.score, 9);
  assert.ok(v.scores);
  assert.equal(v.scores?.prestige, 9);
  assert.equal(v.scores?.theme_alignment, 9);
});

test('decision regenerate → non pass, issues presenti', async () => {
  const json = JSON.stringify({
    scores: FULL_SCORES(4),
    overall: 4,
    decision: 'regenerate',
    issues: ['apri con atmosfera, non col menu', 'togli la griglia di servizi generica'],
  });
  const v = await reviewSite({ llm: fakeLlm(json), business: 'Ristorante', homeHtml: HTML });
  assert.equal(v.pass, false);
  assert.equal(v.decision, 'regenerate');
  assert.ok(v.issues.length > 0);
});

test('LLM in errore → best-effort pass (non blocca la creazione)', async () => {
  const v = await reviewSite({ llm: failingLlm(), business: 'X', homeHtml: HTML });
  assert.equal(v.pass, true);
  assert.equal(v.decision, 'pass');
  assert.equal(v.scores, null);
});

test('home vuota → pass senza interpellare il modello', async () => {
  const v = await reviewSite({ llm: failingLlm(), business: 'X', homeHtml: '' });
  assert.equal(v.pass, true);
});

test('soglia configurabile: revise sotto soglia → non pass', async () => {
  const json = JSON.stringify({ scores: FULL_SCORES(7), overall: 7, decision: 'revise', issues: ['rendi la hero più ariosa'] });
  const v = await reviewSite({ llm: fakeLlm(json), business: 'X', homeHtml: HTML, minScore: 8 });
  assert.equal(v.pass, false); // overall 7 < soglia 8 e decision != pass
});

test('revise sopra soglia → pass', async () => {
  const json = JSON.stringify({ scores: FULL_SCORES(8), overall: 8, decision: 'revise', issues: [] });
  const v = await reviewSite({ llm: fakeLlm(json), business: 'X', homeHtml: HTML, minScore: 7 });
  assert.equal(v.pass, true);
});

test('overall mancante → derivato dalla media degli assi', async () => {
  const json = JSON.stringify({ scores: FULL_SCORES(6), decision: 'revise', issues: [] });
  const v = await reviewSite({ llm: fakeLlm(json), business: 'X', homeHtml: HTML, minScore: 7 });
  assert.equal(v.score, 6); // media di tutti 6 = 6
  assert.equal(v.pass, false); // 6 < 7
});
