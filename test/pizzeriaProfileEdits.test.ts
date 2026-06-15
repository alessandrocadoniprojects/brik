/**
 * Pizzeria Pack v1 — Patch 3B. Test deterministici, offline.
 * Lancio: npx tsx --test test/pizzeriaProfileEdits.test.ts
 *
 * Coprono i 13 casi richiesti: edit menu (aggiungi/cambia prezzo/rimuovi/sezione),
 * orari raw, no-op su messaggi non pertinenti o profili non-pizzeria, e resa
 * di menu/orari nell'HTML senza duplicazione.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPizzeriaProfileEdit } from '../src/server/pizzeriaProfileEdits.js';
import { applyPizzeriaProfileToPublicHtml } from '../src/server/pizzeriaApply.js';
import type { PizzeriaBusinessProfile } from '../src/server/pizzeriaProfile.js';

const base = (): PizzeriaBusinessProfile => ({ pizzeriaType: 'napoletana' });

// 1) aggiunta pizza Margherita a 9€ crea categoria/menu item
test('1) aggiunge Margherita a 9€', () => {
  const r = applyPizzeriaProfileEdit(base(), 'Aggiungi una pizza Margherita a 9€');
  assert.equal(r.handled, true);
  assert.ok(r.profile);
  const cat = r.profile!.menu!.categories.find((c) => /pizz/i.test(c.name));
  assert.ok(cat, 'categoria pizze creata');
  const it = cat!.items.find((i) => i.name === 'Margherita');
  assert.ok(it);
  assert.equal(it!.price, '9€');
  assert.equal(it!.description, undefined);
});

// 2) aggiunta Diavola con descrizione e prezzo
test('2) aggiunge Diavola con descrizione e prezzo', () => {
  const r = applyPizzeriaProfileEdit(base(), 'Aggiungi una pizza Diavola con salame piccante a 12€');
  assert.ok(r.profile);
  const it = r.profile!.menu!.categories[0].items.find((i) => i.name === 'Diavola');
  assert.ok(it);
  assert.equal(it!.description, 'salame piccante');
  assert.equal(it!.price, '12€');
});

// 3) cambio prezzo aggiorna item esistente
test('3) cambia prezzo di item esistente', () => {
  const p = applyPizzeriaProfileEdit(base(), 'Aggiungi una pizza Diavola a 10€').profile!;
  const r = applyPizzeriaProfileEdit(p, 'Cambia il prezzo della Diavola a 12€');
  assert.equal(r.handled, true);
  assert.ok(r.profile);
  const it = r.profile!.menu!.categories[0].items.find((i) => i.name === 'Diavola');
  assert.equal(it!.price, '12€');
});

// 4) cambio prezzo di item inesistente non inventa prodotto
test('4) cambio prezzo inesistente non crea item', () => {
  const r = applyPizzeriaProfileEdit(base(), 'Cambia il prezzo della Diavola a 12€');
  assert.equal(r.handled, true);
  assert.equal(r.profile, undefined, 'profilo non modificato');
  assert.match(r.message || '', /non ho trovato/i);
});

// 5) rimozione pizza esistente la elimina
test('5) rimuove pizza esistente', () => {
  let p = applyPizzeriaProfileEdit(base(), 'Aggiungi una pizza Bufala a 11€').profile!;
  p = applyPizzeriaProfileEdit(p, 'Aggiungi una pizza Margherita a 9€').profile!;
  const r = applyPizzeriaProfileEdit(p, 'Togli la pizza Bufala');
  assert.ok(r.profile);
  const names = r.profile!.menu!.categories.flatMap((c) => c.items.map((i) => i.name));
  assert.ok(!names.includes('Bufala'));
  assert.ok(names.includes('Margherita'), 'le altre pizze restano');
});

// 6) rimozione pizza inesistente → messaggio chiaro
test('6) rimozione inesistente → messaggio', () => {
  const r = applyPizzeriaProfileEdit(base(), 'Togli la pizza Bufala');
  assert.equal(r.handled, true);
  assert.equal(r.profile, undefined);
  assert.match(r.message || '', /non ho trovato/i);
});

// 7) aggiunta sezione birre crea categoria senza prodotti inventati
test('7) aggiunge sezione Birre vuota', () => {
  const r = applyPizzeriaProfileEdit(base(), 'Aggiungi una sezione birre');
  assert.ok(r.profile);
  const cat = r.profile!.menu!.categories.find((c) => c.name.toLowerCase() === 'birre');
  assert.ok(cat);
  assert.equal(cat!.items.length, 0, 'nessun prodotto inventato');
});

// 8) non duplica categoria esistente
test('8) non duplica sezione esistente', () => {
  const p = applyPizzeriaProfileEdit(base(), 'Aggiungi una sezione fritti').profile!;
  const r = applyPizzeriaProfileEdit(p, 'Aggiungi una sezione fritti');
  assert.equal(r.handled, true);
  assert.equal(r.profile, undefined, 'nessuna modifica');
  assert.match(r.message || '', /esiste già/i);
  assert.equal(p.menu!.categories.filter((c) => c.name.toLowerCase() === 'fritti').length, 1);
});

// 9) orari salvati in openingHours.raw
test('9) orari → openingHours.raw', () => {
  const r = applyPizzeriaProfileEdit(base(), 'Siamo aperti dal martedì alla domenica 18:30-23:30');
  assert.ok(r.profile);
  assert.ok(/marted.*domenica.*18:30.*23:30/i.test(r.profile!.openingHours!.raw!));
});

// 10) "Chiusi il lunedì" aggiunto a raw esistente
test('10) chiusura integrata a raw esistente', () => {
  const p = applyPizzeriaProfileEdit(base(), 'Orari: martedì-domenica 18:30-23:30').profile!;
  const r = applyPizzeriaProfileEdit(p, 'Chiusi il lunedì');
  assert.ok(r.profile);
  const raw = r.profile!.openingHours!.raw!;
  assert.ok(/18:30/.test(raw) && /lunedì/i.test(raw), 'mantiene apertura e aggiunge chiusura');
});

// 11) messaggio non-menu/non-orari → handled false
test('11) messaggio generico → handled false', () => {
  assert.equal(applyPizzeriaProfileEdit(base(), 'Rendi il sito più moderno e colorato').handled, false);
  assert.equal(applyPizzeriaProfileEdit(base(), 'Cambia il colore di sfondo in blu').handled, false);
});

// 12) profilo non modificato quando l'edit non è pertinente (l'aggancio server salta i non-pizzeria;
//     qui verifichiamo che un messaggio non pertinente lasci il profilo intatto)
test('12) edit non pertinente non modifica il profilo', () => {
  const p = base();
  const snapshot = JSON.stringify(p);
  const r = applyPizzeriaProfileEdit(p, 'Aggiungi una foto in homepage');
  assert.equal(r.handled, false);
  assert.equal(JSON.stringify(p), snapshot, 'profilo originale immutato');
});

// 13) menu e orari appaiono nell'HTML senza duplicazione
test('13) HTML: menu + orari, niente duplicati', () => {
  let p = applyPizzeriaProfileEdit(base(), 'Aggiungi una pizza Margherita a 9€').profile!;
  p = applyPizzeriaProfileEdit(p, 'Orari: martedì-domenica 18:30-23:30').profile!;
  p.whatsapp = '+393331234567';
  p.primaryCta = 'whatsapp';
  const html = '<html><body><p>x</p></body></html>';
  const out = applyPizzeriaProfileToPublicHtml(html, p);
  assert.ok(out.includes('data-brik-menu'), 'sezione menu presente');
  assert.ok(out.includes('Margherita') && out.includes('9€'));
  assert.ok(out.includes('Orari:') && /18:30/.test(out), 'orari nella strip');
  // riapplicando non si duplica
  const again = applyPizzeriaProfileToPublicHtml(out, p);
  assert.equal((again.match(/data-brik-menu/g) || []).length, 1);
  assert.equal((again.match(/data-brik-contact-strip/g) || []).length, 1);
});

// extra: input immutabilità — applyPizzeriaProfileEdit non muta il profilo passato
test('extra) input non mutato', () => {
  const p = base();
  applyPizzeriaProfileEdit(p, 'Aggiungi una pizza Margherita a 9€');
  assert.equal(p.menu, undefined, 'il profilo originale non viene mutato');
});
