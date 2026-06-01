/**
 * CheckSpec — criterio di accettazione in forma TIPIZZATA e verificabile.
 *
 * È il fulcro che rende il Livello 2 affidabile: invece di testo libero
 * ("fai una bella pagina"), un criterio testabile è un tipo noto + parametri.
 * L'intake classifica l'intento dell'utente in uno di questi tipi (compito
 * affidabile per un LLM); la GENERAZIONE del test è poi deterministica, da
 * template verificati (vedi qa/level2). Ciò che non mappa su un tipo noto
 * NON viene auto-verificato: viene segnalato all'utente.
 *
 * Aggiungere un nuovo tipo di check = estendere questa unione + aggiungere il
 * relativo template in qa/level2. Nient'altro cambia.
 */

export type CheckSpec =
  | ContentPresentCheck
  | RouteLoadsCheck
  | NavigationCheck
  | FormSubmissionCheck
  | ResponsiveCheck;

/** Un testo atteso è presente su una pagina. */
export interface ContentPresentCheck {
  readonly kind: 'content-present';
  readonly route: string;
  readonly text: string;
}

/** Una pagina si carica correttamente (200, render). Usato anche dal Livello 1. */
export interface RouteLoadsCheck {
  readonly kind: 'route-loads';
  readonly route: string;
}

/** Da una pagina, un link porta alla destinazione attesa. */
export interface NavigationCheck {
  readonly kind: 'navigation';
  readonly fromRoute: string;
  readonly linkText: string;
  readonly toRoutePattern: string;
}

/** Compilare e inviare un form produce l'esito atteso. */
export interface FormSubmissionCheck {
  readonly kind: 'form-submission';
  readonly route: string;
  readonly fields: readonly FormField[];
  /** Cosa ci si aspetta dopo l'invio. */
  readonly expect: 'confirmation-visible';
  readonly confirmationText: string;
}

export interface FormField {
  /** Label o name del campo (l'utente lo descrive in parole). */
  readonly label: string;
  readonly value: string;
}

/** La pagina è utilizzabile su viewport mobile (nessun overflow orizzontale). */
export interface ResponsiveCheck {
  readonly kind: 'responsive';
  readonly route: string;
}

export type CheckKind = CheckSpec['kind'];
