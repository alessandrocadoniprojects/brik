/**
 * Adapter di recapito form "di proprieta".
 *
 * Il form fa POST same-origin a /api/contact: NON dipende da servizi terzi nel
 * markup e non espone chiavi. La consegna effettiva la fa una Cloudflare Pages
 * Function (deployata insieme al sito) che inoltra via Resend alla casella del
 * proprietario del sito — destinazione bakeata per-sito al momento del deploy,
 * cosi non e un campo manipolabile dal browser.
 *
 * In anteprima (server locale) /api/contact e uno stub che risponde 200, quindi
 * il form mostra la conferma senza inviare nulla.
 */
import type { FormDelivery, FormDeliveryDescriptor } from '@core';

export function makeOwnedFormDelivery(opts: { readonly path?: string } = {}): FormDelivery {
  const action = opts.path ?? '/api/contact';
  return {
    describe(): FormDeliveryDescriptor {
      // nessun campo nascosto: la destinazione vive lato server, non nel form
      return { action, method: 'POST', hiddenFields: {}, endpointHost: '' };
    },
  };
}
