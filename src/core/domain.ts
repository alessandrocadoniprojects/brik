/**
 * Tipi di dominio condivisi.
 *
 * Sono il vocabolario del prodotto: lo Spec confermato all'intake, i criteri
 * di accettazione osservabili (Livello 0), l'artefatto di build, il deploy.
 * Tutti i tipi sono pensati per essere estesi senza rotture: i campi futuri
 * (QA, brand-kit, integrazioni) si aggiungono come proprietà opzionali o
 * nuove interfacce, senza toccare il flusso esistente.
 */

import type { CheckSpec } from './criteria.js';

/** Categorie comuni seminate nella libreria (Fase 4 le espande tutte). */
export type ProjectCategory =
  | 'business-landing'
  | 'lead-landing'
  | 'booking'
  | 'ecommerce'
  | 'portfolio'
  | 'directory'
  | 'blog'
  | 'crud-app';

/** Una pagina di un sito multi-pagina: percorso servito + HTML autosufficiente. */
export interface SitePage {
  readonly route: string;
  readonly html: string;
}

/** Una voce di struttura: percorso + etichetta nel menu. */
export interface SiteRoute {
  readonly route: string;
  readonly label: string;
}

/**
 * Criterio di accettazione OSSERVABILE (Livello 0).
 * Deve essere verificabile da una persona o da un test, non vago.
 * In Fase 1 ognuno genera un test E2E (Livello 2).
 */
export interface AcceptanceCriterion {
  readonly id: string;
  /** Es. "Un visitatore invia il form contatti e l'owner riceve l'email." */
  readonly statement: string;
  /** Confermato dall'utente all'intake. */
  readonly confirmed: boolean;
  /**
   * Forma tipizzata e testabile (Livello 2). Se assente, il criterio NON è
   * auto-verificabile e va segnalato all'utente invece di fingere un test.
   */
  readonly check?: CheckSpec;
}

/** Brand-kit dell'utente (Fase 4). Opzionale: lo skeleton non lo usa ancora. */
export interface BrandKit {
  readonly logoUrl?: string;
  readonly colors?: readonly string[];
  readonly fontFamily?: string;
}

/**
 * ProjectSpec — la "verità di riferimento" prodotta e confermata all'intake.
 * Lo skeleton lo riceve già pronto; in Fase 1 lo costruisce l'intake guidato.
 */
export interface ProjectSpec {
  readonly id: string;
  readonly ownerId: string;
  readonly category: ProjectCategory;
  readonly title: string;
  readonly description: string;
  readonly criteria: readonly AcceptanceCriterion[];
  /**
   * Materiale REALE fornito dall'utente (testo estratto dagli allegati e/o da un
   * sito importato). NON genera criteri di QA verbatim: è una FONTE di testi e dati
   * veri che il generatore usa per riempire la prima bozza invece di inventare placeholder.
   */
  readonly content?: string;
  /** Estensioni future, già previste come opzionali: */
  readonly brandKit?: BrandKit;
  /** URL/screenshot di riferimento estetico (Fase 4). */
  readonly designReferences?: readonly string[];
  /** Lingue richieste (i18n, Fase 4). Default singola. */
  readonly locales?: readonly string[];
}

/** Codice generato pronto per la build, in forma di file virtuali. */
export interface GeneratedProject {
  readonly specId: string;
  readonly files: readonly SourceFile[];
  /** Template/tema di partenza usato (per tracciare la libreria pattern). */
  readonly templateId: string;
}

export interface SourceFile {
  readonly path: string;
  readonly contents: string;
}

/** Esito della build in sandbox. */
export interface BuildArtifact {
  readonly specId: string;
  /** Percorso/handle dell'output buildato (dipende dall'adapter). */
  readonly artifactRef: string;
  readonly logs: readonly string[];
}

/** Esito del deploy. */
export interface DeployResult {
  readonly specId: string;
  readonly url: string;
}
