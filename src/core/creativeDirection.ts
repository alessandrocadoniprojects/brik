/**
 * Tipi del LIVELLO DECISIONALE ("Creative Director System").
 *
 * Questo file definisce SOLO forme di dati: nessuna logica, nessun import dal
 * generatore o dagli adapter. Il livello decisionale (Industry Engine, Pattern
 * Database) produce una `CreativeDirection` che, in step SUCCESSIVI, condizionerà
 * il generatore HTML esistente. In questo Step 1 nessuno importa ancora questi
 * tipi nel percorso di runtime: sono moduli scollegati.
 *
 * Nota di disaccoppiamento: i nomi delle 8 identità sono replicati qui come
 * unione di stringhe invece di importare `ThemeName` dagli adapter. Così il
 * `core` non dipende dagli adapter. È una RACCOMANDAZIONE: a valle il generatore
 * valida comunque il tema (isTheme), quindi un eventuale disallineamento è innocuo.
 */

/** Le 8 identità esistenti (specchio di THEME_NAMES in designSystem.ts). */
export type RecommendedTheme =
  | 'editorial-luxury'
  | 'athletic-premium'
  | 'scandinavian-service'
  | 'modern-saas'
  | 'creative-studio'
  | 'future-minimal'
  | 'modern-community'
  | 'industrial-bold';

/** Settori riconosciuti in questa fase. `generic` è il fallback sicuro. */
export type Industry = 'restaurant' | 'dentist' | 'law_firm' | 'creative_agency' | 'consulting_advisory' | 'generic';

/** Pattern compositivi dominanti del Pattern Database. `none` = nessuna direttiva. */
export type PatternKey =
  | 'atmosphere-first'
  | 'calm-medical-trust'
  | 'transformation-without-noise'
  | 'professional-inevitability'
  | 'editorial-authority'
  | 'creative-portfolio-authority'
  | 'advisory-method-trust'
  | 'none';

/**
 * Una voce del Pattern Database: il pattern dominante tradotto in direttive
 * concrete e brevi. Le direttive sono in italiano perché (in step successivi)
 * confluiranno nel prompt di generazione, che è in italiano.
 */
export interface CompositionPattern {
  readonly key: PatternKey;
  readonly label: string;
  readonly directives: readonly string[];
}

/**
 * Seed per-settore: la "DNA" decisionale. I campi prestige/visualDNA usano la
 * terminologia fornita dall'utente (label umane), il pattern usa una chiave del DB.
 */
export interface IndustrySeed {
  readonly industry: Industry;
  readonly primaryEmotion: string;
  readonly prestigeProfile: string;
  readonly visualDNA: string;
  readonly dominantPattern: PatternKey;
  /** Identità consigliata tra le 8 esistenti (sovrascrivibile dall'utente). */
  readonly recommendedTheme?: RecommendedTheme;
  /** Variante per le identità che la supportano (es. scandinavian/creative). */
  readonly recommendedVariant?: 'light' | 'dark';
  /** Principio-guida (non copy letterale del sito). */
  readonly headlineSeed: string;
  /** Suggerimento di CTA per il sito generato. */
  readonly ctaSeed: string;
  /** Cliché da evitare per questo settore (max 3 utili nel prompt). */
  readonly antiCliches: readonly string[];
  /** Direttive creative TERSE (max 3): pensate per stare in una riga di prompt. */
  readonly directionHints: readonly string[];
  /** Soggetti fotografici CONCRETI consigliati per il settore (guidano le query immagini). */
  readonly photoSubjects?: readonly string[];
  /** Soggetti fotografici da EVITARE per il settore (anti-cliché visivi). */
  readonly photoAvoid?: readonly string[];
  /** Filo narrativo: l'arco emotivo che ogni sezione del sito deve seguire. */
  readonly narrative?: string;
  /** Voce dei testi (vale anche per i servizi): tono e registro richiesti. */
  readonly voice?: string;
}

/**
 * Output del livello decisionale: l'oggetto che (in step successivi) verrà
 * allegato allo spec come `creative_direction` e loggato. In Step 1 è solo un
 * valore calcolabile e testabile, non collegato alla generazione.
 */
export interface CreativeDirection {
  readonly industry: Industry;
  /** true se il settore è stato rilevato/forzato a un valore non generico. */
  readonly detected: boolean;
  readonly primaryEmotion: string;
  readonly prestigeProfile: string;
  readonly visualDNA: string;
  readonly dominantPattern: PatternKey;
  readonly recommendedTheme?: RecommendedTheme;
  readonly recommendedVariant?: 'light' | 'dark';
  readonly headlineSeed: string;
  readonly ctaSeed: string;
  readonly antiCliches: readonly string[];
  readonly directionHints: readonly string[];
  /** Soggetti fotografici consigliati / da evitare (guidano le query immagini). */
  readonly photoSubjects?: readonly string[];
  readonly photoAvoid?: readonly string[];
  /** Filo narrativo del sito e voce dei testi (servizi inclusi). */
  readonly narrative?: string;
  readonly voice?: string;
  /** Direttive compositive risolte dal Pattern Database per il pattern dominante. */
  readonly directives: readonly string[];
}
