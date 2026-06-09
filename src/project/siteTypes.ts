/** Tipi del progetto-sito persistito (Fase 3 / tappa 2). */
import type { ProjectSpec, SitePage, SiteRoute, AcceptanceCriterion } from '@core';
import type { CreativeDirection } from '@core/creativeDirection.js';

/**
 * Direzione creativa "congelata" al momento della creazione, salvata nello stato
 * così che la finalizzazione premium al publish rigeneri con ESATTAMENTE la stessa
 * direzione decisa in preview, invece di ricostruirla da dati incompleti (titolo).
 * Contiene la direzione completa più ciò che serve a una rigenerazione fedele:
 * le note già pronte per il prompt e il tema effettivamente usato.
 */
export interface SavedCreativeDirection {
  readonly direction: CreativeDirection; // industry, emotion, prestige, pattern, recommendedTheme, antiCliches, …
  readonly notes: readonly string[]; // creativeNotes già formattate per il prompt
  readonly theme: string | null; // effectiveTheme usato in generazione (null = default del generatore)
}

export type SiteStatus = 'preview' | 'approved' | 'published' | 'locked';

export interface SiteState {
  readonly id: string;
  readonly spec: ProjectSpec; // contratto (criteri con route)
  readonly statements: readonly string[]; // frasi-requisito sorgente
  readonly routes: readonly SiteRoute[]; // struttura (pagine + etichette menu)
  readonly pages: readonly SitePage[]; // pagine correnti
  readonly status: SiteStatus;
  readonly version: number;
  readonly updatedAt: string;
  readonly publishedAt?: string;
  readonly url?: string;
  /** Abilitato (pagato/sbloccato): esente dal lock di fine prova, resta online. */
  readonly entitled?: boolean;
  /** Fine del periodo di prova (ISO). Oltre questa data, se non entitled, il sito va in lock. */
  readonly trialEndsAt?: string;
  /** Modifiche ACCETTATE finora (per il cap di prova). Assente = 0. */
  readonly editCount?: number;
  /** Direzione creativa congelata alla creazione, per la finalizzazione premium al publish. */
  readonly creativeDirection?: SavedCreativeDirection;
  /** Fast Preview: route interne ancora in preparazione (placeholder). Vuoto/assente = sito completo. */
  readonly pendingRoutes?: readonly string[];
  /** Fast Preview: la home e renderizzabile ma il QA in background non e diventato verde. */
  readonly previewIssues?: boolean;
}

export interface SiteHistoryEntry {
  readonly version: number;
  readonly criteria: readonly AcceptanceCriterion[];
  readonly statements: readonly string[];
  readonly routes: readonly SiteRoute[];
  readonly pages: readonly SitePage[];
  readonly note: string;
  readonly at: string;
}

export interface SiteFile {
  readonly schemaVersion: 2;
  readonly state: SiteState;
  readonly history: readonly SiteHistoryEntry[];
}
