import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PIZZERIA_ARCHETYPES,
  PIZZERIA_PRESET_REGISTRY,
  PIZZERIA_STYLE_PRESETS,
} from '../src/core/pizzeriaPresets.js';
import { computePizzeriaGenome, pizzeriaGenomeNotes } from '../src/server/pizzeriaGenome.js';
import { designCss, THEME_NAMES, assertPizzeriaSignatureCoverage } from '../src/adapters/anthropic/designSystem.js';

test('preset registry covers exactly eight canonical presets', () => {
  assert.equal(PIZZERIA_STYLE_PRESETS.length, 8);
  assert.deepEqual(Object.keys(PIZZERIA_PRESET_REGISTRY).sort(), [...PIZZERIA_STYLE_PRESETS].sort());
});

test('every preset resolves to its canonical archetype and valid theme', () => {
  const seen = new Set<string>();
  for (const preset of PIZZERIA_STYLE_PRESETS) {
    const genome = computePizzeriaGenome({ stylePreset: preset })!;
    const expected = PIZZERIA_PRESET_REGISTRY[preset];
    assert.equal(genome.archetype, expected.archetype);
    assert.equal(genome.bodyClass, expected.archetype);
    assert.equal(genome.recommendedTheme, expected.theme);
    assert.ok(THEME_NAMES.includes(genome.recommendedTheme));
    assert.match(pizzeriaGenomeNotes(genome)[0]!, /^PIZZERIA_PRESET: pz-/);
    seen.add(genome.archetype);
  }
  assert.equal(seen.size, 8);
});

test('every generated archetype has a CSS signature in every global theme', () => {
  for (const theme of THEME_NAMES) {
    const css = designCss(theme);
    assertPizzeriaSignatureCoverage(css);
    for (const archetype of PIZZERIA_ARCHETYPES) assert.ok(css.includes(`body.${archetype}`), `${theme} missing ${archetype}`);
  }
});

test('legacy food classes are compatibility-only and not canonical archetypes', () => {
  for (const legacy of ['pz-pop', 'pz-minimal', 'pz-osteria', 'pz-night']) {
    assert.ok(!PIZZERIA_ARCHETYPES.includes(legacy as never));
  }
});
