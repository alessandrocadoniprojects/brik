/**
 * Test deterministici del livello decisionale (Industry Engine + Pattern Database).
 * Offline, nessuna rete. Lancio: npx tsx --test test/industryEngine.test.ts
 *
 * Verificano che il modulo sia coerente e che la mappatura settore → identità/
 * pattern rispetti i seed concordati. Non toccano runtime né generazione.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectIndustry,
  creativeDirectionForIndustry,
  creativeDirectionFromDescription,
  recommendedThemeFromDescription,
  creativeNotesFor,
  preferredTheme,
  INDUSTRY_SEEDS,
  PATTERN_DB,
} from '../src/intake/industryEngine.js';
import { isTheme } from '../src/adapters/anthropic/designSystem.js';
import { explicitName } from '../src/intake/sitePlanner.js';

test('detectIndustry riconosce i tre settori e ricade su generic', () => {
  assert.equal(detectIndustry('Ristorante di pesce a Milano con menu degustazione'), 'restaurant');
  assert.equal(detectIndustry('Studio dentistico, ortodonzia e igiene dentale'), 'dentist');
  assert.equal(detectIndustry('Studio legale, contenzioso civile'), 'law_firm');
  assert.equal(detectIndustry('Negozio di fiori online'), 'generic');
  assert.equal(detectIndustry(''), 'generic');
});

test('i seed rispettano la mappatura settore → identità concordata', () => {
  assert.equal(INDUSTRY_SEEDS.restaurant.recommendedTheme, 'editorial-luxury');
  assert.equal(INDUSTRY_SEEDS.restaurant.dominantPattern, 'atmosphere-first');
  assert.equal(INDUSTRY_SEEDS.dentist.recommendedTheme, 'scandinavian-service');
  assert.equal(INDUSTRY_SEEDS.dentist.dominantPattern, 'transformation-without-noise');
  assert.equal(INDUSTRY_SEEDS.law_firm.recommendedTheme, 'editorial-luxury');
  assert.equal(INDUSTRY_SEEDS.law_firm.dominantPattern, 'editorial-authority');
});

test('creativeDirectionForIndustry risolve le direttive dal Pattern Database', () => {
  const cd = creativeDirectionForIndustry('restaurant');
  assert.equal(cd.detected, true);
  assert.equal(cd.recommendedTheme, 'editorial-luxury');
  assert.deepEqual([...cd.directives], [...PATTERN_DB['atmosphere-first'].directives]);
  assert.ok(cd.directives.length > 0);
});

test('generic è un fallback sicuro: nessun tema forzato, nessuna direttiva', () => {
  const cd = creativeDirectionForIndustry('generic');
  assert.equal(cd.detected, false);
  assert.equal(cd.recommendedTheme, undefined);
  assert.equal(cd.dominantPattern, 'none');
  assert.equal(cd.directives.length, 0);
});

test('creativeDirectionFromDescription collega rilevamento e composizione', () => {
  const cd = creativeDirectionFromDescription('Trattoria con cucina tradizionale');
  assert.equal(cd.industry, 'restaurant');
  assert.equal(cd.detected, true);
  assert.equal(cd.ctaSeed, 'Prenota un tavolo');
});

test('i seed includono anti-cliché e hint di direzione (max 3 utili)', () => {
  assert.ok(INDUSTRY_SEEDS.restaurant.antiCliches.length > 0);
  assert.ok(INDUSTRY_SEEDS.restaurant.directionHints.length > 0);
  assert.equal(INDUSTRY_SEEDS.generic.antiCliches.length, 0);
  assert.equal(INDUSTRY_SEEDS.generic.directionHints.length, 0);
});

test('creativeNotesFor produce le righe nel formato richiesto per un settore noto', () => {
  const lines = creativeNotesFor(creativeDirectionForIndustry('restaurant'));
  const joined = lines.join('\n');
  // Deve contenere le voci-chiave del formato concordato.
  assert.match(joined, /settore rilevato: ristorante/);
  assert.match(joined, /emozione: desiderio/);
  assert.match(joined, /pattern: Atmosphere First/);
  assert.match(joined, /tema consigliato: editorial-luxury/);
  assert.match(joined, /CTA sito: Prenota un tavolo/);
  assert.match(joined, /DIRETTIVE DEL PATTERN/);     // ora le direttive del pattern sono esplicite
  assert.match(joined, /VIETATO/);                    // anti-cliché come riga dura
  assert.match(joined, /DIVIETI TASSATIVI/);          // divieti universali
  assert.match(joined, /direzione: /);
  // Il formato è più ricco di prima ma resta limitato: non deve esplodere.
  assert.ok(lines.length <= 20);
});

test('creativeNotesFor è vuoto per generic: nessun blocco nel prompt', () => {
  assert.equal(creativeNotesFor(creativeDirectionForIndustry('generic')).length, 0);
});

test('dentist: creativeNotesFor include foto consigliate/da evitare, racconto e voce', () => {
  const lines = creativeNotesFor(creativeDirectionForIndustry('dentist'));
  const blob = lines.join('\n');
  assert.match(blob, /foto consigliate/);
  assert.match(blob, /poltrona odontoiatrica/);
  assert.match(blob, /foto da evitare/);
  assert.match(blob, /corridoi ospedalieri/);
  assert.match(blob, /racconto del sito/);
  assert.match(blob, /voce dei testi/);
});

// --- Fase 2.5: rilevamento creative agency + naming esplicito ---

test('creative agency: il prompt completo da industry creative_agency, detected, tema e directives', () => {
  const p = 'Agenzia creativa milanese specializzata in brand identity, art direction e siti per brand premium. Nome: Studio Brera. Stile: bold creative, editoriale, tipografico, minimale, premium.';
  const cd = creativeDirectionFromDescription(p);
  assert.equal(cd.industry, 'creative_agency');
  assert.equal(cd.detected, true);
  assert.equal(cd.recommendedTheme, 'creative-studio');
  assert.equal(cd.dominantPattern, 'creative-portfolio-authority');
  assert.ok(cd.primaryEmotion.length > 0);     // emozione valorizzata
  assert.ok(cd.directives.length > 0);         // directives > 0
});

test('creative agency: trigger singoli (brand identity, art direction, studio grafico)', () => {
  assert.equal(detectIndustry('Ci occupiamo di brand identity per startup'), 'creative_agency');
  assert.equal(detectIndustry('Studio di art direction e fotografia'), 'creative_agency');
  assert.equal(detectIndustry('Siamo uno studio grafico a Torino'), 'creative_agency');
});

test('creative agency: tema consigliato creative-studio via preferredTheme', () => {
  const pref = preferredTheme(undefined, creativeDirectionForIndustry('creative_agency'), isTheme);
  assert.equal(pref.theme, 'creative-studio');
  assert.equal(pref.source, 'creative_direction');
});

test('creative agency: creativeNotesFor valorizzato (pattern + foto + racconto + voce)', () => {
  const blob = creativeNotesFor(creativeDirectionForIndustry('creative_agency')).join('\n');
  assert.match(blob, /Creative Portfolio Authority/);
  assert.match(blob, /portfolio|opere selezionate/);
  assert.match(blob, /racconto del sito/);
  assert.match(blob, /voce dei testi/);
});

test('detection: un prompt chiaramente di ristorante NON finisce in creative_agency', () => {
  assert.equal(detectIndustry('Trattoria con cucina toscana e menu di stagione'), 'restaurant');
});

// --- Fase 2.7: rilevamento consulting / strategic advisory ---

test('consulting: il prompt completo da industry consulting_advisory, detected, tema e directives', () => {
  const p = 'Studio di consulenza strategica e business advisory a Catanzaro: riorganizzazione, crescita aziendale e passaggio generazionale.';
  const cd = creativeDirectionFromDescription(p);
  assert.equal(cd.industry, 'consulting_advisory');
  assert.equal(cd.detected, true);
  assert.equal(cd.recommendedTheme, 'scandinavian-service');
  assert.equal(cd.dominantPattern, 'advisory-method-trust');
  assert.ok(cd.primaryEmotion.length > 0);
  assert.ok(cd.directives.length > 0);
});

test('consulting: trigger singoli (consulenza strategica, business advisory, passaggio generazionale)', () => {
  assert.equal(detectIndustry('Offriamo consulenza strategica alle PMI'), 'consulting_advisory');
  assert.equal(detectIndustry('Business advisory per aziende familiari'), 'consulting_advisory');
  assert.equal(detectIndustry('Accompagniamo il passaggio generazionale d\'impresa'), 'consulting_advisory');
});

test('consulting: tema scandinavian-service via preferredTheme', () => {
  const pref = preferredTheme(undefined, creativeDirectionForIndustry('consulting_advisory'), isTheme);
  assert.equal(pref.theme, 'scandinavian-service');
  assert.equal(pref.source, 'creative_direction');
});

test('consulting: creativeNotesFor valorizzato (pattern + anti-cliché duri + foto + racconto + voce)', () => {
  const blob = creativeNotesFor(creativeDirectionForIndustry('consulting_advisory')).join('\n');
  assert.match(blob, /Advisory Method Trust/);
  assert.match(blob, /metodo e giudizio/i);
  assert.match(blob, /decisioni difficili/i);
  assert.match(blob, /VIETATO/);
  assert.match(blob, /soluzioni su misura|partner per la crescita/);
  assert.match(blob, /handshake|meeting in posa/);
  assert.match(blob, /racconto del sito/);
  assert.match(blob, /voce dei testi/);
});

test('detection: un prompt chiaramente di ristorante NON finisce in consulting_advisory', () => {
  assert.equal(detectIndustry('Pizzeria napoletana con forno a legna'), 'restaurant');
});

// --- Fase 2.6: compliance — direttive del pattern e divieti nel prompt ---

test('2.6: creativeNotesFor(creative_agency) contiene le direttive del pattern', () => {
  const blob = creativeNotesFor(creativeDirectionForIndustry('creative_agency')).join('\n').toLowerCase();
  assert.match(blob, /direttive del pattern/);
  assert.match(blob, /punto di vista/);
  assert.match(blob, /lavori selezionati/);
  assert.match(blob, /struttura da builder/);
  assert.match(blob, /numeri finti|contator/);
});

test('2.6: creativeNotesFor(creative_agency) contiene i divieti espliciti', () => {
  const blob = creativeNotesFor(creativeDirectionForIndustry('creative_agency')).join('\n').toLowerCase();
  assert.match(blob, /emoji/);
  assert.match(blob, /data-count/);
  assert.match(blob, /metrica o statistica inventata|inventat/);
  assert.match(blob, /griglia di card uniformi/);
});

test('2.6: creativeNotesFor(generic) resta vuoto (nessuna direttiva creative_agency)', () => {
  assert.equal(creativeNotesFor(creativeDirectionForIndustry('generic')).length, 0);
});

test('naming: explicitName preserva un nome esplicito, altrimenti null', () => {
  assert.equal(explicitName('… Nome: Studio Brera. Stile: bold creative.'), 'Studio Brera');
  assert.equal(explicitName('Il locale si chiama Osteria del Borgo a Lucca'), 'Osteria del Borgo a Lucca');
  assert.equal(explicitName('Agenzia creativa milanese, senza nome indicato'), null);
});

// --- Step 4: scelta del tema preferito (gerarchia utente > creative_direction > default) ---

test('dentist senza tema utente → scandinavian-service da creative_direction', () => {
  const pref = preferredTheme(undefined, creativeDirectionForIndustry('dentist'), isTheme);
  assert.equal(pref.theme, 'scandinavian-service');
  assert.equal(pref.source, 'creative_direction');
});

test('restaurant senza tema utente → editorial-luxury da creative_direction', () => {
  const pref = preferredTheme(undefined, creativeDirectionForIndustry('restaurant'), isTheme);
  assert.equal(pref.theme, 'editorial-luxury');
  assert.equal(pref.source, 'creative_direction');
});

test('law_firm senza tema utente → editorial-luxury da creative_direction', () => {
  const pref = preferredTheme(undefined, creativeDirectionForIndustry('law_firm'), isTheme);
  assert.equal(pref.theme, 'editorial-luxury');
  assert.equal(pref.source, 'creative_direction');
});

test('tema esplicito dell\'utente NON viene sovrascritto dalla creative_direction', () => {
  // L'utente ha scelto industrial-bold per un ristorante: deve prevalere.
  const pref = preferredTheme('industrial-bold', creativeDirectionForIndustry('restaurant'), isTheme);
  assert.equal(pref.theme, 'industrial-bold');
  assert.equal(pref.source, 'user');
});

test('recommendedTheme non valido → fallback sicuro al default', () => {
  // Simulo un seed corrotto con un tema inesistente: il validatore lo scarta.
  const bogus = { recommendedTheme: 'theme-che-non-esiste' as unknown as undefined };
  const pref = preferredTheme(undefined, bogus, isTheme);
  assert.equal(pref.theme, null);
  assert.equal(pref.source, 'default');
});

// --- Micro-patch tema: recommendedThemeFromDescription (varietà, anti-noir) ---

test('tema: ristorazione casual → scandinavian-service di default, warm-bistro con BRIK_THEME_BISTRO=on', () => {
  const prev = process.env.BRIK_THEME_BISTRO;
  delete process.env.BRIK_THEME_BISTRO;
  assert.equal(recommendedThemeFromDescription('Pizzeria di quartiere a Napoli'), 'scandinavian-service');
  assert.equal(recommendedThemeFromDescription('Trattoria familiare con cucina casalinga'), 'scandinavian-service');
  process.env.BRIK_THEME_BISTRO = 'on';
  assert.equal(recommendedThemeFromDescription('Pizzeria di quartiere a Napoli'), 'warm-bistro');
  assert.equal(recommendedThemeFromDescription('Trattoria familiare con cucina casalinga'), 'warm-bistro');
  assert.equal(recommendedThemeFromDescription('Panificio artigianale con colazioni'), 'warm-bistro');
  if (prev == null) delete process.env.BRIK_THEME_BISTRO; else process.env.BRIK_THEME_BISTRO = prev;
});

test('tema: ristorazione fascia alta / chef → editorial-luxury', () => {
  assert.equal(recommendedThemeFromDescription('Ristorante gourmet con menu degustazione'), 'editorial-luxury');
  assert.equal(recommendedThemeFromDescription('Fine dining dello chef stellato'), 'editorial-luxury');
  assert.equal(recommendedThemeFromDescription('Percorso di degustazione e alta cucina'), 'editorial-luxury');
});

test('tema: pet grooming → scandinavian-service, pet spa di lusso → editorial-luxury', () => {
  assert.equal(recommendedThemeFromDescription('Toelettatura cani e gatti'), 'scandinavian-service');
  assert.equal(recommendedThemeFromDescription('Pet spa di lusso per cani'), 'editorial-luxury');
});

test('tema: dentista moderno → non editorial-luxury', () => {
  const theme = recommendedThemeFromDescription('Studio dentistico moderno, ortodonzia e igiene');
  assert.notEqual(theme, 'editorial-luxury');
  assert.equal(theme, 'scandinavian-service');
});

test('tema: noleggio auto generico → scandinavian-service', () => {
  assert.equal(recommendedThemeFromDescription('Noleggio auto a breve termine in aeroporto'), 'scandinavian-service');
  assert.equal(recommendedThemeFromDescription('Autonoleggio economico in città'), 'scandinavian-service');
});

test('tema: noleggio furgoni / flotte / macchinari → industrial-bold', () => {
  assert.equal(recommendedThemeFromDescription('Noleggio furgoni per traslochi'), 'industrial-bold');
  assert.equal(recommendedThemeFromDescription('Gestione flotte aziendali e mezzi da lavoro'), 'industrial-bold');
  assert.equal(recommendedThemeFromDescription('Noleggio macchinari per cantieri'), 'industrial-bold');
});

test('tema: noleggio supercar → athletic-premium (editorial-luxury solo se lusso esplicito)', () => {
  assert.equal(recommendedThemeFromDescription('Noleggio supercar e auto sportive'), 'athletic-premium');
  assert.equal(recommendedThemeFromDescription('Noleggio supercar di lusso esclusive'), 'editorial-luxury');
});

test('tema: SaaS / software / AI → modern-saas', () => {
  assert.equal(recommendedThemeFromDescription('SaaS di intelligenza artificiale per le vendite'), 'modern-saas');
  assert.equal(recommendedThemeFromDescription('Software gestionale b2b con dashboard'), 'modern-saas');
});

test('tema: fotografo / portfolio → creative-studio', () => {
  assert.equal(recommendedThemeFromDescription('Fotografo con portfolio di matrimoni'), 'creative-studio');
  assert.equal(recommendedThemeFromDescription('Studio di branding e art direction'), 'creative-studio');
});

test('tema: fitness / sport → athletic-premium', () => {
  assert.equal(recommendedThemeFromDescription('Palestra e personal trainer'), 'athletic-premium');
  assert.equal(recommendedThemeFromDescription('Centro padel e campi da tennis'), 'athletic-premium');
});

test('tema: architettura / finanza → future-minimal; consulenza premium → future-minimal', () => {
  assert.equal(recommendedThemeFromDescription('Studio di architettura e innovazione'), 'future-minimal');
  assert.equal(recommendedThemeFromDescription('Consulenza fintech e finanza d\'impresa'), 'future-minimal');
  assert.equal(recommendedThemeFromDescription('Consulenza premium per top management'), 'future-minimal');
});

test('tema: consulenza generica → scandinavian-service', () => {
  assert.equal(recommendedThemeFromDescription('Consulenza strategica e business advisory per PMI'), 'scandinavian-service');
});

test('tema: associazioni / eventi / community → modern-community', () => {
  assert.equal(recommendedThemeFromDescription('Associazione culturale che organizza eventi'), 'modern-community');
  assert.equal(recommendedThemeFromDescription('Spazio di coworking e community di professionisti'), 'modern-community');
});

test('tema: descrizione vuota / generica → scandinavian-service (mai noir)', () => {
  assert.equal(recommendedThemeFromDescription(''), 'scandinavian-service');
  assert.equal(recommendedThemeFromDescription('Negozio di fiori online'), 'scandinavian-service');
  assert.equal(recommendedThemeFromDescription('Attività commerciale generica'), 'scandinavian-service');
});

test('regressione anti-noir: set vario non torna editorial-luxury senza keyword luxury/fine dining', () => {
  const varied = [
    'Pizzeria di quartiere',
    'Studio dentistico moderno',
    'Noleggio auto economico',
    'Palestra di crossfit',
    'Software gestionale per negozi',
    'Fotografo di ritratti',
    'Associazione sportiva dilettantistica',
    'Idraulico e installazioni',
    'Parrucchiere per signora',
    'Negozio di abbigliamento',
  ];
  for (const d of varied) {
    assert.notEqual(recommendedThemeFromDescription(d), 'editorial-luxury', `inatteso noir per: ${d}`);
  }
  // Controprova: le keyword esplicite SÌ devono dare editorial-luxury
  assert.equal(recommendedThemeFromDescription('Ristorante gourmet stellato'), 'editorial-luxury');
  assert.equal(recommendedThemeFromDescription('Hotel 5 stelle di lusso'), 'editorial-luxury');
});

test('integrazione: creativeDirectionFromDescription + preferredTheme propagano il tema', () => {
  const prev = process.env.BRIK_THEME_BISTRO;
  delete process.env.BRIK_THEME_BISTRO;
  const cd = creativeDirectionFromDescription('Pizzeria di quartiere');
  assert.equal(cd.recommendedTheme, 'scandinavian-service');
  const pref = preferredTheme(undefined, cd, isTheme);
  assert.equal(pref.theme, 'scandinavian-service');
  process.env.BRIK_THEME_BISTRO = 'on';
  const cdBistro = creativeDirectionFromDescription('Pizzeria di quartiere');
  assert.equal(cdBistro.recommendedTheme, 'warm-bistro');
  if (prev == null) delete process.env.BRIK_THEME_BISTRO; else process.env.BRIK_THEME_BISTRO = prev;
  assert.equal(pref.source, 'creative_direction');
});
