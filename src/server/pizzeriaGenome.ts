/**
 * Pizzeria vertical genome.
 *
 * Fonte canonica: PIZZERIA_PRESET_REGISTRY. Il preset scelto dall'utente vince
 * sul rilevamento euristico del tipo; il theme resta un theme globale valido,
 * mentre l'archetipo controlla la signature verticale tramite body class.
 */
import type { PizzeriaBusinessProfile, PizzeriaType, PizzeriaMood, BusinessProfile } from './pizzeriaProfile.js';
import type { RecommendedTheme } from '../core/creativeDirection.js';
import {
  PIZZERIA_PRESET_REGISTRY,
  type PizzeriaArchetype,
} from '../core/pizzeriaPresets.js';

export type { PizzeriaArchetype } from '../core/pizzeriaPresets.js';

export interface PizzeriaGenome {
  archetype: PizzeriaArchetype;
  heroPattern: 'pizza-poster' | 'oven-first' | 'menu-first' | 'split-editorial' | 'atmosphere-first';
  menuPattern: 'editorial' | 'compact' | 'signature' | 'category';
  ctaStrategy: 'prenota' | 'whatsapp' | 'chiama' | 'menu' | 'maps' | 'asporto';
  imageStrategy: 'pizza' | 'oven' | 'hands' | 'interior' | 'ingredients' | 'street-counter';
  sectionOrder: string[];
  density: 'compact' | 'balanced' | 'editorial';
  copyTone: 'traditional' | 'modern' | 'family' | 'premium' | 'direct' | 'convivial';
  bodyClass: PizzeriaArchetype;
  recommendedTheme: RecommendedTheme;
}

interface BaseConfig {
  heroPattern: PizzeriaGenome['heroPattern'];
  menuPattern: PizzeriaGenome['menuPattern'];
  imageStrategy: PizzeriaGenome['imageStrategy'];
  copyTone: PizzeriaGenome['copyTone'];
  density: PizzeriaGenome['density'];
  defaultCta: PizzeriaGenome['ctaStrategy'];
}

const ARCHETYPE_BY_TYPE: Record<PizzeriaType, PizzeriaArchetype> = {
  napoletana: 'pz-napoli',
  contemporanea: 'pz-contemporary',
  'al-taglio': 'pz-al-taglio',
  familiare: 'pz-family',
  gourmet: 'pz-gourmet',
  'pizza-birre-vini': 'pz-beer-wine',
  generic: 'pz-napoli',
};

const BASE: Record<PizzeriaArchetype, BaseConfig> = {
  'pz-napoli': { heroPattern: 'oven-first', menuPattern: 'editorial', imageStrategy: 'oven', copyTone: 'traditional', density: 'balanced', defaultCta: 'prenota' },
  'pz-contemporary': { heroPattern: 'split-editorial', menuPattern: 'signature', imageStrategy: 'ingredients', copyTone: 'modern', density: 'editorial', defaultCta: 'prenota' },
  'pz-al-taglio': { heroPattern: 'menu-first', menuPattern: 'compact', imageStrategy: 'street-counter', copyTone: 'direct', density: 'compact', defaultCta: 'asporto' },
  'pz-family': { heroPattern: 'atmosphere-first', menuPattern: 'category', imageStrategy: 'interior', copyTone: 'family', density: 'balanced', defaultCta: 'prenota' },
  'pz-gourmet': { heroPattern: 'split-editorial', menuPattern: 'signature', imageStrategy: 'ingredients', copyTone: 'premium', density: 'editorial', defaultCta: 'prenota' },
  'pz-beer-wine': { heroPattern: 'atmosphere-first', menuPattern: 'category', imageStrategy: 'interior', copyTone: 'convivial', density: 'balanced', defaultCta: 'prenota' },
  'pz-romana': { heroPattern: 'pizza-poster', menuPattern: 'signature', imageStrategy: 'pizza', copyTone: 'modern', density: 'balanced', defaultCta: 'menu' },
  'pz-delivery': { heroPattern: 'menu-first', menuPattern: 'compact', imageStrategy: 'pizza', copyTone: 'direct', density: 'compact', defaultCta: 'asporto' },
};

const THEME_BY_ARCHETYPE: Record<PizzeriaArchetype, RecommendedTheme> = {
  'pz-napoli': 'warm-bistro',
  'pz-contemporary': 'warm-bistro',
  'pz-al-taglio': 'warm-bistro',
  'pz-family': 'warm-bistro',
  'pz-gourmet': 'editorial-luxury',
  'pz-beer-wine': 'warm-bistro',
  'pz-romana': 'warm-bistro',
  'pz-delivery': 'warm-bistro',
};

function applyMood(cfg: BaseConfig, mood: PizzeriaMood): BaseConfig {
  switch (mood) {
    case 'young-vibrant': return { ...cfg, copyTone: 'modern' };
    case 'minimal-contemporary': return { ...cfg, copyTone: 'modern', density: 'editorial', heroPattern: 'split-editorial' };
    case 'evening-intimate': return { ...cfg, copyTone: 'convivial' };
    case 'family-welcoming': return { ...cfg, copyTone: 'family' };
    case 'premium-curated': return { ...cfg, copyTone: 'premium', density: 'editorial' };
    case 'warm-traditional': return { ...cfg, copyTone: 'traditional' };
    default: return cfg;
  }
}

function ctaStrategyFor(profile: PizzeriaBusinessProfile, base: BaseConfig): PizzeriaGenome['ctaStrategy'] {
  if (profile.primaryCta) return profile.primaryCta;
  if (profile.services?.takeaway) return profile.whatsapp ? 'whatsapp' : 'asporto';
  if (profile.whatsapp) return 'whatsapp';
  return base.defaultCta;
}

function sectionOrderFor(hero: PizzeriaGenome['heroPattern']): string[] {
  if (hero === 'menu-first') return ['hero', 'menu', 'highlights', 'about', 'gallery', 'contact'];
  if (hero === 'atmosphere-first') return ['hero', 'about', 'gallery', 'menu', 'highlights', 'contact'];
  if (hero === 'oven-first') return ['hero', 'about', 'menu', 'gallery', 'highlights', 'contact'];
  return ['hero', 'menu', 'highlights', 'about', 'gallery', 'contact'];
}

export function computePizzeriaGenome(profile: PizzeriaBusinessProfile | undefined | null): PizzeriaGenome | undefined {
  if (!profile) return undefined;
  const preset = profile.stylePreset ? PIZZERIA_PRESET_REGISTRY[profile.stylePreset] : undefined;
  const archetype = preset?.archetype ?? ARCHETYPE_BY_TYPE[profile.pizzeriaType ?? 'generic'];
  let cfg = { ...BASE[archetype] };
  if (profile.desiredMood) cfg = applyMood(cfg, profile.desiredMood);
  return {
    archetype,
    heroPattern: cfg.heroPattern,
    menuPattern: cfg.menuPattern,
    ctaStrategy: ctaStrategyFor(profile, BASE[archetype]),
    imageStrategy: cfg.imageStrategy,
    sectionOrder: sectionOrderFor(cfg.heroPattern),
    density: cfg.density,
    copyTone: cfg.copyTone,
    bodyClass: archetype,
    recommendedTheme: preset?.theme ?? THEME_BY_ARCHETYPE[archetype],
  };
}

const TONE_IT: Record<PizzeriaGenome['copyTone'], string> = {
  traditional: 'tradizionale e autentico', modern: 'moderno e pulito', family: 'caldo e familiare',
  premium: 'curato e premium', direct: 'diretto e concreto', convivial: 'conviviale e informale',
};
const HERO_IT: Record<PizzeriaGenome['heroPattern'], string> = {
  'pizza-poster': 'una grande immagine di pizza come poster', 'oven-first': 'il forno e la brace in apertura',
  'menu-first': 'il menu subito in evidenza', 'split-editorial': "un'apertura editoriale a due colonne",
  'atmosphere-first': "l'atmosfera del locale in apertura",
};
const MENU_IT: Record<PizzeriaGenome['menuPattern'], string> = {
  editorial: 'editoriale, con respiro e descrizioni curate', compact: 'compatto e veloce da scorrere',
  signature: 'incentrato sulle pizze signature', category: 'organizzato per categorie chiare',
};
const IMG_IT: Record<PizzeriaGenome['imageStrategy'], string> = {
  pizza: 'primi piani delle pizze', oven: 'forno a legna e cottura', hands: "le mani al lavoro sull'impasto",
  interior: 'gli ambienti del locale', ingredients: 'gli ingredienti e i dettagli',
  'street-counter': 'il bancone e il taglio al volo',
};
const CTA_IT: Record<PizzeriaGenome['ctaStrategy'], string> = {
  prenota: 'invitare a prenotare un tavolo', whatsapp: 'contattare su WhatsApp', chiama: 'chiamare il locale',
  menu: 'portare al menu', maps: 'trovare il locale su Maps', asporto: "ordinare d'asporto",
};

export function pizzeriaGenomeNotes(g: PizzeriaGenome): string[] {
  return [
    `PIZZERIA_PRESET: ${g.archetype}.`,
    `VINCOLO HTML: usa <body class="${g.bodyClass}"> su tutte le pagine; non sostituire questa classe con archetipi legacy.`,
    `Tono di voce ${TONE_IT[g.copyTone]}.`,
    `Apertura: ${HERO_IT[g.heroPattern]}.`,
    `Ordine sezioni suggerito: ${g.sectionOrder.join(' → ')}.`,
    `Menu in stile ${MENU_IT[g.menuPattern]}.`,
    `Azione principale: ${CTA_IT[g.ctaStrategy]} — non inventare contatti o link non forniti.`,
    `Immagini: privilegia ${IMG_IT[g.imageStrategy]}; usa solo foto reali se disponibili.`,
    `Densità ${g.density}.`,
  ];
}

export function pizzeriaCreativeNotes(profile: BusinessProfile | undefined | null): string[] {
  if (!profile || profile.kind !== 'pizzeria') return [];
  const genome = computePizzeriaGenome(profile.data);
  return genome ? pizzeriaGenomeNotes(genome) : [];
}

export function pizzeriaRecommendedTheme(profile: BusinessProfile | undefined | null): RecommendedTheme | undefined {
  if (!profile || profile.kind !== 'pizzeria') return undefined;
  return computePizzeriaGenome(profile.data)?.recommendedTheme;
}
