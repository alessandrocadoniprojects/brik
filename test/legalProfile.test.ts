/**
 * Pizzeria Pack v1 — Patch 8. Test deterministici, offline.
 * Lancio: npx tsx --test test/legalProfile.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrivacyPolicy, buildCookiePolicy, validateLegalProfile, LEGAL_DISCLAIMER } from '../src/server/legalProfile.js';
import type { LegalProfile } from '../src/server/legalProfile.js';

// 1) profilo vuoto non inventa dati
test('1) profilo vuoto → nessun dato inventato', () => {
  const priv = buildPrivacyPolicy({});
  // niente nome/P.IVA/indirizzo/email inventati o placeholder
  assert.ok(!/\[.*\]/.test(priv), 'nessun placeholder [..]');
  assert.ok(!/P\.IVA \/ C\.F\.:/.test(priv), 'nessuna riga P.IVA senza dato');
  assert.ok(!/Sede:/.test(priv) && !/Titolare del trattamento: /.test(priv));
  assert.ok(priv.includes(LEGAL_DISCLAIMER), 'disclaimer consulente presente');
});

// 2) privacy usa legalName se presente
test('2) privacy usa legalName', () => {
  const priv = buildPrivacyPolicy({ legalName: 'Pizzeria Da Marco S.r.l.' });
  assert.ok(priv.includes('Pizzeria Da Marco S.r.l.'));
  assert.ok(priv.includes('Titolare del trattamento'));
});

// 3) privacy non contiene P.IVA placeholder quando assente
test('3) niente P.IVA placeholder', () => {
  const priv = buildPrivacyPolicy({ legalName: 'X S.r.l.' });
  assert.ok(!/P\.IVA/i.test(priv) || /P\.IVA \/ C\.F\.: [0-9A-Za-z]/.test(priv), 'P.IVA appare solo con valore reale');
  const priv2 = buildPrivacyPolicy({ legalName: 'X S.r.l.', vatOrTaxId: 'IT01234567890' });
  assert.ok(priv2.includes('IT01234567890'));
});

// 4) cookie technical-only → informativa base, nessun consenso
test('4) cookie technical-only base', () => {
  const ck = buildCookiePolicy({ cookieMode: 'technical-only' });
  assert.match(ck, /cookie tecnici/i);
  // accetta la copy attuale ("non richiede il consenso preventivo") o quella storica
  assert.match(ck, /non richiede il consenso preventivo|non è richiesto il consenso/i);
  // technical-only NON deve promettere un CMP / pannello di consenso da accettare
  assert.ok(!/pannello delle preferenze/i.test(ck), 'nessun pannello preferenze/CMP');
  assert.ok(!/restano disattivati finché/i.test(ck), 'nessun blocco-con-consenso promesso');
  assert.ok(ck.includes(LEGAL_DISCLAIMER));
});

// 5) metaPixel dichiarato ma non iniettato → non in policy + warning
test('5) marketing-pixel → non dichiarato attivo + warning', () => {
  const profile = { legalName: 'A', vatOrTaxId: 'IT1', registeredAddress: 'V', privacyEmail: 'a@b.it', thirdPartyServices: { metaPixel: true } };
  const ck = buildCookiePolicy(profile);
  assert.ok(!/Meta Pixel/i.test(ck), 'Meta Pixel non dichiarato come strumento attivo');
  assert.ok(!/profilazione|marketing/i.test(ck), 'nessuna categoria marketing/profilazione');
  assert.ok(!/pannello delle preferenze/i.test(ck), 'nessun CMP/banner promesso');
  const w = validateLegalProfile(profile);
  assert.ok(w.some((x) => /Brik non inserisce|non verranno dichiarati come trattamenti attivi/i.test(x)), 'warning: servizio non iniettato');
});

// 5b) analytics dichiarato ma non iniettato → non in policy + warning
test('5b) full-analytics → non dichiarato attivo + warning', () => {
  const profile = { legalName: 'A', vatOrTaxId: 'IT1', registeredAddress: 'V', privacyEmail: 'a@b.it', thirdPartyServices: { analytics: true } };
  const ck = buildCookiePolicy(profile);
  assert.ok(!/Cookie analitici|strumenti di analisi/i.test(ck), 'analytics non dichiarato come attivo in policy');
  assert.ok(!/pannello delle preferenze/i.test(ck), 'nessun CMP/banner promesso');
  const w = validateLegalProfile(profile);
  assert.ok(w.some((x) => /Brik non inserisce|non verranno dichiarati come trattamenti attivi/i.test(x)), 'warning: servizio non iniettato');
});

// 6) le pagine non contengono mai un project id (solo dati reali del profilo)
test('6) nessun project id nelle pagine', () => {
  const profile: LegalProfile = { legalName: 'Y S.r.l.', vatOrTaxId: 'IT99', registeredAddress: 'Via Roma 1' };
  const priv = buildPrivacyPolicy(profile);
  const ck = buildCookiePolicy(profile);
  assert.ok(!/site-[a-z0-9]+/i.test(priv) && !/site-[a-z0-9]+/i.test(ck), 'nessun id tecnico site-xxxx');
  assert.ok(!/undefined|null/.test(priv) && !/undefined|null/.test(ck));
});

// 7) dati mancanti → warnings
test('7) dati mancanti → warnings', () => {
  const w = validateLegalProfile({});
  assert.ok(w.length >= 4, 'almeno 4 warning su dati base mancanti');
  assert.ok(w.some((x) => /ragione sociale/i.test(x)));
  assert.ok(w.some((x) => /P\.IVA|codice fiscale/i.test(x)));
  assert.ok(w.some((x) => /email/i.test(x)));
  // profilo completo → meno warning
  const w2 = validateLegalProfile({ legalName: 'A', vatOrTaxId: 'IT1', registeredAddress: 'Via 1', privacyEmail: 'a@b.it', cookieMode: 'technical-only' });
  assert.equal(w2.length, 0, 'profilo coerente e completo → nessun warning');
});

// 7b) pixel dichiarato ma non iniettato da Brik → warning
test('7b) pixel senza modalità marketing → warning', () => {
  const w = validateLegalProfile({ legalName: 'A', vatOrTaxId: 'IT1', registeredAddress: 'V', privacyEmail: 'a@b.it', thirdPartyServices: { metaPixel: true } });
  assert.ok(w.some((x) => /Brik non inserisce|non verranno dichiarati come trattamenti attivi/i.test(x)));
});

// 8) "owner senza legalProfile resta valido": profilo undefined/null non lancia
test('8) profilo assente → nessun crash, output coerente', () => {
  assert.doesNotThrow(() => buildPrivacyPolicy(undefined));
  assert.doesNotThrow(() => buildCookiePolicy(null));
  assert.doesNotThrow(() => validateLegalProfile(undefined));
  const w = validateLegalProfile(undefined);
  assert.ok(Array.isArray(w) && w.length > 0);
  assert.ok(buildPrivacyPolicy(undefined).includes(LEGAL_DISCLAIMER));
});

// 9) finalità e servizi elencano solo i flag true
test('9) solo flag true elencati', () => {
  const priv = buildPrivacyPolicy({ purposes: { reservations: true, marketing: false }, thirdPartyServices: { googleMaps: true, metaPixel: false } });
  assert.match(priv, /prenotazioni/i);
  assert.ok(!/marketing/i.test(priv), 'finalità false non elencata');
  assert.match(priv, /Google Maps/i);
  assert.ok(!/Meta Pixel/i.test(priv), 'servizio false non elencato');
});

// --- Patch arricchimento doc legali ---

test('10) trasferimenti extra-UE solo se servizio rilevante', () => {
  const senza = buildPrivacyPolicy({ legalName: 'X' });
  assert.ok(!/fuori dall’Unione Europea/.test(senza), 'no sezione trasferimenti senza servizi');
  const con = buildPrivacyPolicy({ legalName: 'X', thirdPartyServices: { cloudflareHosting: true } });
  assert.match(con, /fuori dall’Unione Europea/);
  assert.match(con, /clausole contrattuali standard/);
});

test('11) base giuridica mappata per finalità', () => {
  const priv = buildPrivacyPolicy({ purposes: { newsletter: true } });
  assert.match(priv, /base giuridica/i);
  assert.match(priv, /consenso/i);
});

test('12) profilazione solo con strumento marketing realmente caricato', () => {
  const senza = buildPrivacyPolicy({ legalName: 'X' });
  assert.match(senza, /Non viene effettuato alcun processo decisionale automatizzato/);
  // metaPixel dichiarato ma NON iniettato da Brik → nessuna profilazione dichiarata
  const con = buildPrivacyPolicy({ legalName: 'X', thirdPartyServices: { metaPixel: true } });
  assert.match(con, /Non viene effettuato alcun processo decisionale automatizzato/);
  assert.ok(!/profilazione a fini pubblicitari/.test(con), 'nessuna profilazione con pixel non iniettato');
});

test('13) cookie: terze parti nominate dai servizi', () => {
  const ck = buildCookiePolicy({ cookieMode: 'basic-analytics', thirdPartyServices: { googleMaps: true } });
  assert.match(ck, /Servizi di terze parti/);
  assert.match(ck, /Google Maps/);
});

test('14) data ultimo aggiornamento solo se fornita', () => {
  assert.ok(!/Ultimo aggiornamento/.test(buildPrivacyPolicy({ legalName: 'X' })));
  assert.match(buildPrivacyPolicy({ legalName: 'X' }, { dateLabel: '11 giugno 2026' }), /Ultimo aggiornamento: 11 giugno 2026/);
  assert.match(buildCookiePolicy({ cookieMode: 'technical-only' }, { dateLabel: '11 giugno 2026' }), /Ultimo aggiornamento: 11 giugno 2026/);
});

test('15) niente dati inventati nelle nuove sezioni (profilo vuoto)', () => {
  const priv = buildPrivacyPolicy({});
  const ck = buildCookiePolicy({});
  assert.ok(!/\[.*\]/.test(priv) && !/\[.*\]/.test(ck));
  assert.ok(!/undefined|null/.test(priv) && !/undefined|null/.test(ck));
});

// --- Privacy Policy realign: servizi non iniettati + label YouTube --------
test('16) privacy: Meta Pixel flag non compare nei servizi attivi', () => {
  const priv = buildPrivacyPolicy({ legalName: 'X', thirdPartyServices: { metaPixel: true } });
  assert.ok(!/Meta Pixel/i.test(priv), 'Meta Pixel non dichiarato come servizio attivo');
});

test('17) privacy: Google Ads flag non compare nei servizi attivi', () => {
  const priv = buildPrivacyPolicy({ legalName: 'X', thirdPartyServices: { googleAds: true } });
  assert.ok(!/Google Ads/i.test(priv), 'Google Ads non dichiarato come servizio attivo');
});

test('18) privacy: analytics flag non compare nei servizi attivi', () => {
  const priv = buildPrivacyPolicy({ legalName: 'X', thirdPartyServices: { analytics: true } });
  assert.ok(!/strumenti di analisi/i.test(priv), 'analytics non dichiarato come servizio attivo');
});

test('19) privacy: YouTube dichiarato senza Vimeo', () => {
  const priv = buildPrivacyPolicy({ legalName: 'X', thirdPartyServices: { youtubeVimeo: true } });
  assert.match(priv, /YouTube/);
  assert.ok(!/Vimeo/i.test(priv), 'Vimeo non dichiarato come supportato');
});

test('20) privacy: pixel non iniettato → niente servizi attivi né trasferimento extra-UE', () => {
  const priv = buildPrivacyPolicy({ legalName: 'X', thirdPartyServices: { metaPixel: true } });
  assert.ok(!/Servizi di terze parti e responsabili/.test(priv), 'nessuna sezione servizi attivi');
  assert.ok(!/Trasferimento dei dati fuori/.test(priv), 'nessun trasferimento extra-UE');
});

test('21) validate: pixel/ads/analytics non iniettati → warning, non dichiarazione', () => {
  const w = validateLegalProfile({ legalName: 'A', vatOrTaxId: 'IT1', registeredAddress: 'V', privacyEmail: 'a@b.it', thirdPartyServices: { metaPixel: true, googleAds: true, analytics: true } });
  assert.ok(w.some((x) => /Brik non inserisce|non verranno dichiarati come trattamenti attivi/i.test(x)));
});
