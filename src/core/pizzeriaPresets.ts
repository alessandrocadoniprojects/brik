import type { RecommendedTheme } from './creativeDirection.js';

export const PIZZERIA_ARCHETYPES = [
  'pz-napoli',
  'pz-contemporary',
  'pz-al-taglio',
  'pz-family',
  'pz-gourmet',
  'pz-beer-wine',
  'pz-romana',
  'pz-delivery',
] as const;
export type PizzeriaArchetype = (typeof PIZZERIA_ARCHETYPES)[number];

export const PIZZERIA_STYLE_PRESETS = [
  'napoletana-heritage',
  'al-taglio-urban',
  'gourmet-degustazione',
  'familiare-quartiere',
  'pizza-birre-serale',
  'contemporanea-minimal',
  'romana-pinsa-focaccia',
  'delivery-takeaway',
] as const;
export type PizzeriaStylePreset = (typeof PIZZERIA_STYLE_PRESETS)[number];

export interface PizzeriaPresetDefinition {
  readonly archetype: PizzeriaArchetype;
  readonly theme: RecommendedTheme;
}

export const PIZZERIA_PRESET_REGISTRY: Readonly<Record<PizzeriaStylePreset, PizzeriaPresetDefinition>> = {
  'napoletana-heritage': { archetype: 'pz-napoli', theme: 'warm-bistro' },
  'al-taglio-urban': { archetype: 'pz-al-taglio', theme: 'warm-bistro' },
  'gourmet-degustazione': { archetype: 'pz-gourmet', theme: 'editorial-luxury' },
  'familiare-quartiere': { archetype: 'pz-family', theme: 'warm-bistro' },
  'pizza-birre-serale': { archetype: 'pz-beer-wine', theme: 'warm-bistro' },
  'contemporanea-minimal': { archetype: 'pz-contemporary', theme: 'warm-bistro' },
  'romana-pinsa-focaccia': { archetype: 'pz-romana', theme: 'warm-bistro' },
  'delivery-takeaway': { archetype: 'pz-delivery', theme: 'warm-bistro' },
};

export function isPizzeriaStylePreset(value: unknown): value is PizzeriaStylePreset {
  return typeof value === 'string' && (PIZZERIA_STYLE_PRESETS as readonly string[]).includes(value);
}
