/**
 * Pizzeria Pack v1 — Patch 4. Test deterministici, offline.
 * Lancio: npx tsx --test test/startingPointIntake.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STARTING_POINT_OPTIONS,
  SITE_TREATMENT_OPTIONS,
  normalizeStartingPoint,
  extractSocialLinks,
  mergeStartingPointIntoProfile,
  isGoogleMapsUrl,
} from '../src/server/startingPoint.js';
import type { PizzeriaBusinessProfile } from '../src/server/pizzeriaProfile.js';

// 1) le 5 opzioni starting point esistono
test('1) cinque opzioni con i mode attesi', () => {
  assert.equal(STARTING_POINT_OPTIONS.length, 5);
  const modes = STARTING_POINT_OPTIONS.map((o) => o.mode);
  assert.deepEqual(modes, ['existing-site', 'social-or-maps', 'materials', 'guided-from-zero', 'free-description']);
  assert.equal(SITE_TREATMENT_OPTIONS.length, 5);
});

// 2) existing-site salva URL
test('2) existing-site salva existingSiteUrl', () => {
  const sp = normalizeStartingPoint({ mode: 'existing-site', existingSiteUrl: 'https://vecchia-pizzeria.it' });
  assert.ok(sp);
  assert.equal(sp!.mode, 'existing-site');
  assert.equal(sp!.existingSiteUrl, 'https://vecchia-pizzeria.it');
  // dominio nudo → schema aggiunto
  const sp2 = normalizeStartingPoint({ mode: 'existing-site', existingSiteUrl: 'vecchia-pizzeria.it' });
  assert.equal(sp2!.existingSiteUrl, 'https://vecchia-pizzeria.it');
});

// 3) existing-site salva trattamento
test('3) existing-site salva currentSiteTreatment', () => {
  const sp = normalizeStartingPoint({ mode: 'existing-site', currentSiteTreatment: 'keep-content-modernize' });
  assert.equal(sp!.currentSiteTreatment, 'keep-content-modernize');
  // trattamento non valido scartato
  const sp2 = normalizeStartingPoint({ mode: 'existing-site', currentSiteTreatment: 'qualcosa' });
  assert.equal(sp2!.currentSiteTreatment, undefined);
});

// 4) social-or-maps salva link IG/FB/Maps
test('4) social-or-maps salva i link', () => {
  const text = 'Ecco i miei: https://instagram.com/dapeppe e https://facebook.com/dapeppe e https://maps.app.goo.gl/abc123';
  const sp = normalizeStartingPoint({ mode: 'social-or-maps', socialText: text });
  assert.ok(sp!.socialLinks);
  assert.match(sp!.socialLinks!.instagram!, /instagram\.com\/dapeppe/);
  assert.match(sp!.socialLinks!.facebook!, /facebook\.com\/dapeppe/);
  assert.match(sp!.socialLinks!.googleMaps!, /maps\.app\.goo\.gl/);
  // anche via campi espliciti
  const sp2 = normalizeStartingPoint({ mode: 'social-or-maps', socialLinks: { instagram: 'instagram.com/x' } });
  assert.match(sp2!.socialLinks!.instagram!, /instagram\.com\/x/);
});

// 5) materials salva menuText/notes
test('5) materials salva menuText e notes', () => {
  const sp = normalizeStartingPoint({ mode: 'materials', materials: { menuText: 'Margherita 8, Diavola 10', notes: 'Aperti la sera', hasPhotos: true } });
  assert.equal(sp!.materials!.menuText, 'Margherita 8, Diavola 10');
  assert.equal(sp!.materials!.notes, 'Aperti la sera');
  assert.equal(sp!.materials!.hasPhotos, true);
});

// 6) guided-from-zero: solo mode, prosegue
test('6) guided-from-zero salva solo il mode', () => {
  const sp = normalizeStartingPoint({ mode: 'guided-from-zero' });
  assert.equal(sp!.mode, 'guided-from-zero');
  assert.equal(sp!.existingSiteUrl, undefined);
  assert.equal(sp!.socialLinks, undefined);
});

// 7) free-description: solo mode, nessun blocco
test('7) free-description salva solo il mode', () => {
  const sp = normalizeStartingPoint({ mode: 'free-description' });
  assert.equal(sp!.mode, 'free-description');
  assert.ok(sp!.createdAt && sp!.updatedAt);
});

// 8) stato senza startingPoint resta valido
test('8) payload senza mode → null (stato resta valido)', () => {
  assert.equal(normalizeStartingPoint(null), null);
  assert.equal(normalizeStartingPoint({}), null);
  assert.equal(normalizeStartingPoint({ mode: 'inesistente' }), null);
  // merge con intake assente non tocca il profilo
  const prof: PizzeriaBusinessProfile = { pizzeriaType: 'napoletana' };
  assert.equal(mergeStartingPointIntoProfile(undefined, prof).changed, false);
});

// 9) non-pizzeria usa starting point senza creare PizzeriaBusinessProfile
test('9) non-pizzeria: nessun profilo creato dal merge', () => {
  const sp = normalizeStartingPoint({ mode: 'social-or-maps', socialText: 'https://maps.app.goo.gl/xyz' });
  const r = mergeStartingPointIntoProfile(sp, undefined); // nessun profilo esistente
  assert.equal(r.changed, false);
  assert.equal(r.profile, undefined, 'non viene inventato un profilo');
});

// 10) pizzeria con Google Maps salva googleMapsUrl solo se certo
test('10) pizzeria: googleMapsUrl valorizzato solo da Maps certo', () => {
  const prof: PizzeriaBusinessProfile = { pizzeriaType: 'napoletana' };
  const spOk = normalizeStartingPoint({ mode: 'social-or-maps', socialText: 'https://www.google.com/maps/place/DaPeppe' });
  const ok = mergeStartingPointIntoProfile(spOk, prof);
  assert.equal(ok.changed, true);
  assert.match(ok.profile!.googleMapsUrl!, /google\.com\/maps/);
  // link non-Maps non valorizza nulla
  const spNo = normalizeStartingPoint({ mode: 'social-or-maps', socialText: 'https://instagram.com/dapeppe' });
  assert.equal(mergeStartingPointIntoProfile(spNo, prof).changed, false);
  // se il profilo ha già un Maps, non lo sovrascrive
  const profWith: PizzeriaBusinessProfile = { pizzeriaType: 'napoletana', googleMapsUrl: 'https://maps.google.com/esistente' };
  assert.equal(mergeStartingPointIntoProfile(spOk, profWith).changed, false);
});

// extra: isGoogleMapsUrl
test('extra) isGoogleMapsUrl riconosce i formati comuni', () => {
  assert.ok(isGoogleMapsUrl('https://maps.app.goo.gl/abc'));
  assert.ok(isGoogleMapsUrl('https://www.google.com/maps/place/x'));
  assert.ok(isGoogleMapsUrl('https://maps.google.com/?q=x'));
  assert.ok(!isGoogleMapsUrl('https://instagram.com/x'));
  assert.ok(!isGoogleMapsUrl('google maps'));
});
