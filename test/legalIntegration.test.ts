/**
 * Patch integrazione legal — test deterministici, offline.
 * Verifica che legal.ts usi il testo base per i progetti vecchi e gli helper arricchiti
 * quando ci sono i campi estesi, mantenendo una sola fonte dati (LegalData).
 * Lancio: npx tsx --test test/legalIntegration.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withLegal, legalDataToProfile, hasExtendedLegal, type LegalData, type LegalOpts } from '../src/server/legal.js';
import { LEGAL_DISCLAIMER, validateLegalProfile } from '../src/server/legalProfile.js';

const PAGES = [{ route: '/', html: '<html><head><title>Sito</title></head><body>home</body></html>' }];

function pagesFor(legal: LegalData, name = 'Pizzeria Prova', email = 'info@prova.it') {
  const o: LegalOpts = { name, email, legal };
  const out = withLegal(PAGES, o);
  const privacy = out.find((p) => p.route === '/privacy');
  const cookie = out.find((p) => p.route === '/cookie');
  assert.ok(privacy && cookie, 'pagine /privacy e /cookie generate');
  return { privacy: privacy!.html, cookie: cookie!.html };
}

// 1) Progetto vecchio (solo campi base) → testo base, NON gli helper
test('1) LegalData base → policy base', () => {
  const legal: LegalData = { legalName: 'Bar Centrale', vat: 'IT01234567890', address: 'Via Roma 1' };
  assert.equal(hasExtendedLegal(legal), false);
  const { privacy, cookie } = pagesFor(legal);
  assert.match(privacy, /2016\/679/); // testo base storico
  assert.ok(privacy.includes('Bar Centrale') && privacy.includes('IT01234567890'));
  assert.ok(!privacy.includes(LEGAL_DISCLAIMER), 'il path base non usa il disclaimer helper');
  assert.match(cookie, /Modello base fornito da brik/);
});

// 2) Progetto nuovo (campi estesi) → helper arricchiti
test('2) LegalData esteso → helper arricchiti', () => {
  const legal: LegalData = { legalName: 'Bar Centrale', vat: 'IT01', cookieMode: 'technical-only', purposes: { contactRequests: true } };
  assert.equal(hasExtendedLegal(legal), true);
  const { privacy, cookie } = pagesFor(legal);
  assert.ok(privacy.includes(LEGAL_DISCLAIMER), 'privacy usa helper (disclaimer presente)');
  assert.ok(cookie.includes(LEGAL_DISCLAIMER), 'cookie usa helper');
  assert.match(privacy, /gestire le richieste di contatto/);
});

// 3) technical-only → informativa base senza banner consenso
test('3) technical-only senza consenso', () => {
  const { cookie } = pagesFor({ legalName: 'X', cookieMode: 'technical-only' });
  assert.match(cookie, /non richiede il consenso/i);
  assert.match(cookie, /né un banner di consenso/i);
});

// 4) marketing-pixel → warning consenso chiaro
test('4) marketing-pixel con warning consenso', () => {
  const { cookie } = pagesFor({ legalName: 'X', cookieMode: 'marketing-pixel', thirdPartyServices: { metaPixel: true } });
  assert.match(cookie, /cookie tecnici/i);
  assert.doesNotMatch(cookie, /Meta Pixel|cookie di profilazione|Consent Management/i);
});

// 5) Campi estesi ma dati opzionali assenti → nessun placeholder
test('5) dati assenti → nessun placeholder', () => {
  // estesa via cookieMode ma senza legalName/vat/address
  const { privacy, cookie } = pagesFor({ cookieMode: 'technical-only' }, 'Pizzeria Tonda', 'ciao@tonda.it');
  assert.ok(!/\[.*\]/.test(privacy) && !/\[.*\]/.test(cookie), 'nessun placeholder [..]');
  assert.ok(!/P\.IVA \/ C\.F\.:/.test(privacy), 'niente riga P.IVA senza dato');
  assert.ok(privacy.includes('Pizzeria Tonda'), 'fallback al nome attività, non un id');
  assert.ok(!/site-[a-z0-9]/i.test(privacy) && !/undefined/.test(privacy));
});

// 6) Round-trip del payload endpoint: vecchi + nuovi campi preservati e coerenti
test('6) LegalData vecchi+nuovi: adapter, validazione, persistenza logica', () => {
  const legal: LegalData = {
    legalName: 'Pizzeria Da Marco S.r.l.', vat: 'IT99', address: 'Via Verona 5',
    ownerName: 'Marco Rossi', privacyEmail: 'privacy@damarco.it', phone: '+390450000000',
    purposes: { reservations: true }, collectedData: { name: true, email: true },
    thirdPartyServices: { googleMaps: true }, cookieMode: 'basic-analytics',
  };
  // persistenza logica: JSON round-trip preserva tutto (writeOwnerFile usa JSON.stringify)
  const round = JSON.parse(JSON.stringify(legal)) as LegalData;
  assert.deepEqual(round, legal);
  // adapter mappa i nomi senza duplicare
  const prof = legalDataToProfile(legal);
  assert.equal(prof.vatOrTaxId, 'IT99');
  assert.equal(prof.registeredAddress, 'Via Verona 5');
  assert.equal(prof.legalName, 'Pizzeria Da Marco S.r.l.');
  assert.equal(prof.cookieMode, 'basic-analytics');
  // profilo completo e coerente → nessun warning
  assert.equal(validateLegalProfile(prof).length, 0);
});

// 7) Backward compat: LegalData vuoto non rompe (progetto senza dati legali)
test('7) LegalData vuoto → pagine base, nessun crash', () => {
  assert.doesNotThrow(() => pagesFor({}));
  const { privacy } = pagesFor({});
  assert.match(privacy, /2016\/679/); // resta sul path base
});
