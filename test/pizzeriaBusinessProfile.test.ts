/**
 * Pizzeria Pack v1 — Patch 2. Test deterministici, offline.
 * Lancio: npx tsx --test test/pizzeriaBusinessProfile.test.ts
 *
 * Coprono i 10 casi richiesti: rilevamento pizzeria, estrazione sicura, nessun
 * dato inventato, nessun placeholder, backward-compatibility del profilo opzionale.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPizzeriaDescription,
  extractPizzeriaBusinessProfile,
  type BusinessProfile,
} from '../src/server/pizzeriaProfile.js';

// 1) descrizione pizzeria crea profilo
test('1) descrizione pizzeria crea un profilo', () => {
  const p = extractPizzeriaBusinessProfile('Pizzeria con forno a legna, margherita e diavola.');
  assert.ok(p, 'doveva creare un profilo');
  assert.equal(typeof p, 'object');
});

// 2) descrizione non pizzeria ritorna null
test('2) descrizione non pizzeria ritorna null', () => {
  assert.equal(extractPizzeriaBusinessProfile('Studio dentistico moderno a Torino.'), null);
  assert.equal(isPizzeriaDescription('Studio dentistico moderno a Torino.'), false);
});

// 3) "Pizzeria Da Marco a Verona" estrae businessName e city
test('3) estrae businessName e city', () => {
  const p = extractPizzeriaBusinessProfile('Pizzeria Da Marco a Verona, forno a legna, WhatsApp 3331234567, aperti martedì-domenica 18:30-23:30.');
  assert.ok(p);
  assert.equal(p!.businessName, 'Pizzeria Da Marco');
  assert.equal(p!.city, 'Verona');
  assert.equal(p!.whatsapp, '3331234567');
  assert.ok(p!.openingHours?.raw && /marted.*domenica.*18:30.*23:30/i.test(p!.openingHours.raw), 'raw orari atteso');
});

// 4) "pizza al taglio" produce pizzeriaType al-taglio
test('4) pizzeriaType al-taglio', () => {
  const p = extractPizzeriaBusinessProfile('Pizzeria al taglio a Milano con asporto, prezzi chiari e WhatsApp.');
  assert.ok(p);
  assert.equal(p!.pizzeriaType, 'al-taglio');
  assert.equal(p!.city, 'Milano');
});

// 5) "asporto" imposta services.takeaway
test('5) asporto imposta services.takeaway', () => {
  const p = extractPizzeriaBusinessProfile('Pizzeria a Milano con asporto.');
  assert.ok(p);
  assert.equal(p!.services?.takeaway, true);
});

// 6) WhatsApp esplicito viene riconosciuto + diventa primaryCta
test('6) WhatsApp riconosciuto e primaryCta', () => {
  const p = extractPizzeriaBusinessProfile('Pizzeria al taglio a Milano con asporto, prezzi chiari e WhatsApp 3387654321.');
  assert.ok(p);
  assert.equal(p!.whatsapp, '3387654321');
  assert.equal(p!.primaryCta, 'whatsapp'); // WhatsApp esplicito ha priorità
});

// 7) telefono/indirizzo/email non vengono inventati
test('7) nessun dato inventato quando non esplicito', () => {
  const p = extractPizzeriaBusinessProfile('Pizzeria con forno a legna a Napoli.');
  assert.ok(p);
  assert.equal(p!.phone, undefined);
  assert.equal(p!.email, undefined);
  assert.equal(p!.address, undefined);
  assert.equal(p!.whatsapp, undefined);
  assert.equal(p!.menu, undefined);
});

// 8) descrizione generica "ristorante" non crea profilo pizzeria
test('8) "ristorante" da solo non crea profilo', () => {
  assert.equal(extractPizzeriaBusinessProfile('Ristorante elegante a Roma con cucina di pesce.'), null);
  assert.equal(extractPizzeriaBusinessProfile('Trattoria tipica toscana.'), null);
});

// 9) output non contiene placeholder
test('9) numeri/email placeholder non vengono estratti', () => {
  const p = extractPizzeriaBusinessProfile('Pizzeria Da Test, WhatsApp 000 000 0000, email info@example.com, tel 045 000 0000.');
  assert.ok(p);
  assert.equal(p!.whatsapp, undefined, 'numero placeholder non deve essere estratto');
  assert.equal(p!.phone, undefined, 'telefono placeholder non deve essere estratto');
  assert.equal(p!.email, undefined, 'email placeholder non deve essere estratta');
  // nessun valore stringa del profilo contiene un segnaposto noto
  const blob = JSON.stringify(p);
  assert.ok(!/example\.com|000 000 0000|lorem ipsum|site-/i.test(blob));
});

// 10) backward compatibility: stato senza businessProfile resta valido
test('10) profilo opzionale: assenza non rompe nulla', () => {
  // un "owner file" senza businessProfile è perfettamente valido
  const ownerLike: { email?: string; legal?: object; businessProfile?: BusinessProfile } = { email: 'x@y.it', legal: {} };
  assert.equal(ownerLike.businessProfile, undefined);
  // e si può aggiungere il profilo senza alterare il resto
  const prof = extractPizzeriaBusinessProfile('Pizzeria napoletana a Caserta.');
  assert.ok(prof);
  const withProfile = { ...ownerLike, businessProfile: { kind: 'pizzeria' as const, data: prof! } };
  assert.equal(withProfile.email, 'x@y.it');
  assert.equal(withProfile.businessProfile.kind, 'pizzeria');
  assert.equal(withProfile.businessProfile.data.pizzeriaType, 'napoletana');
});

// extra: non-pizzeria varie restano null (robustezza rilevatore)
test('extra) rilevatore stretto', () => {
  assert.equal(isPizzeriaDescription('Pizzeria Bella Napoli'), true);
  assert.equal(isPizzeriaDescription('Facciamo pizza napoletana'), true);
  assert.equal(isPizzeriaDescription('Bar caffetteria'), false);
  assert.equal(isPizzeriaDescription('Gelateria artigianale'), false);
});
