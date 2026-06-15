/**
 * Pizzeria Pack v1 — Patch 6. Test deterministici, offline.
 * Lancio: npx tsx --test test/pizzeriaGenome.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePizzeriaGenome, pizzeriaGenomeNotes, pizzeriaCreativeNotes } from '../src/server/pizzeriaGenome.js';
import type { PizzeriaBusinessProfile } from '../src/server/pizzeriaProfile.js';

const g = (p: PizzeriaBusinessProfile) => computePizzeriaGenome(p)!;

// 1) napoletana → pz-napoli
test('1) napoletana → pz-napoli', () => {
  const genome = g({ pizzeriaType: 'napoletana' });
  assert.equal(genome.archetype, 'pz-napoli');
  assert.equal(genome.heroPattern, 'oven-first');
  assert.equal(genome.menuPattern, 'editorial');
  assert.equal(genome.imageStrategy, 'oven');
  assert.equal(genome.copyTone, 'traditional');
  assert.equal(genome.density, 'balanced');
});

// 2) al-taglio / asporto → pz-al-taglio
test('2) al-taglio → pz-al-taglio', () => {
  const genome = g({ pizzeriaType: 'al-taglio' });
  assert.equal(genome.archetype, 'pz-al-taglio');
  assert.equal(genome.heroPattern, 'menu-first');
  assert.equal(genome.menuPattern, 'compact');
  assert.equal(genome.imageStrategy, 'street-counter');
  assert.equal(genome.copyTone, 'direct');
  assert.equal(genome.density, 'compact');
  assert.ok(genome.ctaStrategy === 'asporto' || genome.ctaStrategy === 'whatsapp');
});

// 3) contemporanea / minimal → pz-contemporary
test('3) contemporanea → pz-contemporary', () => {
  const genome = g({ pizzeriaType: 'contemporanea', desiredMood: 'minimal-contemporary' });
  assert.equal(genome.archetype, 'pz-contemporary');
  assert.equal(genome.heroPattern, 'split-editorial');
  assert.equal(genome.menuPattern, 'signature');
  assert.equal(genome.copyTone, 'modern');
  assert.equal(genome.density, 'editorial');
});

// 4) familiare → pz-family
test('4) familiare → pz-family', () => {
  const genome = g({ pizzeriaType: 'familiare' });
  assert.equal(genome.archetype, 'pz-family');
  assert.equal(genome.heroPattern, 'atmosphere-first');
  assert.equal(genome.menuPattern, 'category');
  assert.equal(genome.imageStrategy, 'interior');
  assert.equal(genome.copyTone, 'family');
});

// 5) gourmet → pz-gourmet, NON luxury-noir
test('5) gourmet → pz-gourmet, non luxury-noir', () => {
  const genome = g({ pizzeriaType: 'gourmet' });
  assert.equal(genome.archetype, 'pz-gourmet');
  assert.equal(genome.bodyClass, 'pz-gourmet');
  assert.ok(!/luxury|noir/.test(genome.bodyClass));
  assert.equal(genome.copyTone, 'premium');
  assert.equal(genome.menuPattern, 'signature');
});

// 6) pizza-birre-vini → pz-beer-wine
test('6) pizza-birre-vini → pz-beer-wine', () => {
  const genome = g({ pizzeriaType: 'pizza-birre-vini' });
  assert.equal(genome.archetype, 'pz-beer-wine');
  assert.equal(genome.heroPattern, 'atmosphere-first');
  assert.equal(genome.menuPattern, 'category');
  assert.equal(genome.copyTone, 'convivial');
});

// 7) primaryCta WhatsApp influenza ctaStrategy
test('7) primaryCta whatsapp → ctaStrategy whatsapp', () => {
  const genome = g({ pizzeriaType: 'napoletana', primaryCta: 'whatsapp', whatsapp: '+393331234567' });
  assert.equal(genome.ctaStrategy, 'whatsapp');
});

// 8) services.takeaway influenza ctaStrategy
test('8) takeaway → ctaStrategy asporto/whatsapp', () => {
  const noWa = g({ pizzeriaType: 'napoletana', services: { takeaway: true } });
  assert.equal(noWa.ctaStrategy, 'asporto');
  const withWa = g({ pizzeriaType: 'napoletana', services: { takeaway: true }, whatsapp: '+393331234567' });
  assert.equal(withWa.ctaStrategy, 'whatsapp');
});

// 9) desiredMood modifica l'output quando coerente
test('9) desiredMood cambia il tono', () => {
  const senza = g({ pizzeriaType: 'napoletana' });
  const con = g({ pizzeriaType: 'napoletana', desiredMood: 'premium-curated' });
  assert.equal(senza.copyTone, 'traditional');
  assert.equal(con.copyTone, 'premium');
  assert.notEqual(senza.copyTone, con.copyTone);
});

// 10) genome produce bodyClass
test('10) bodyClass presente e coerente con archetype', () => {
  const genome = g({ pizzeriaType: 'contemporanea' });
  assert.equal(genome.bodyClass, genome.archetype);
  assert.equal(genome.bodyClass, 'pz-contemporary');
  // e le note sono generabili
  const notes = pizzeriaGenomeNotes(genome);
  assert.ok(notes.length > 0 && notes.every((n) => typeof n === 'string' && n.length > 0));
});

// 11) non-pizzeria non produce genome
test('11) profilo assente → nessun genome', () => {
  assert.equal(computePizzeriaGenome(undefined), undefined);
  assert.equal(computePizzeriaGenome(null), undefined);
});

// --- Patch 6B: aggancio a creativeNotes -----------------------------------

// 6B.1) pizzeria napoletana aggiunge note genome
test('6B.1) pizzeria napoletana → note genome non vuote', () => {
  const notes = pizzeriaCreativeNotes({ kind: 'pizzeria', data: { pizzeriaType: 'napoletana' } });
  assert.ok(notes.length > 0);
  assert.ok(notes.some((n) => n.includes('pz-napoli')));
  assert.ok(notes.some((n) => /tradizional/i.test(n)));
});

// 6B.2) al-taglio produce note diverse da napoletana
test('6B.2) al-taglio → note diverse da napoletana', () => {
  const napoli = pizzeriaCreativeNotes({ kind: 'pizzeria', data: { pizzeriaType: 'napoletana' } });
  const taglio = pizzeriaCreativeNotes({ kind: 'pizzeria', data: { pizzeriaType: 'al-taglio' } });
  assert.notDeepEqual(napoli, taglio);
  assert.ok(taglio.some((n) => n.includes('pz-al-taglio')));
});

// 6B.3) non-pizzeria non aggiunge note
test('6B.3) non-pizzeria → nessuna nota', () => {
  assert.deepEqual(pizzeriaCreativeNotes(undefined), []);
  assert.deepEqual(pizzeriaCreativeNotes(null), []);
});

// 6B.4) profilo assente non cambia le creativeNotes base
test('6B.4) composizione: base invariata senza profilo', () => {
  const base = ['Direzione di base A', 'Direzione di base B'];
  const composed = [...base, ...pizzeriaCreativeNotes(undefined)];
  assert.deepEqual(composed, base);
});

// 6B.5) le note base restano presenti e il genome si aggiunge in coda
test('6B.5) composizione: base preservata + genome in coda', () => {
  const base = ['Direzione di base A'];
  const composed = [...base, ...pizzeriaCreativeNotes({ kind: 'pizzeria', data: { pizzeriaType: 'gourmet' } })];
  assert.equal(composed[0], 'Direzione di base A', 'la direzione di base resta in testa');
  assert.ok(composed.length > 1, 'le note genome sono aggiunte');
  assert.ok(composed.some((n) => n.includes('pz-gourmet')));
});
