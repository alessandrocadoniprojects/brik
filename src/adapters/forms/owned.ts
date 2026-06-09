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

export function makeOwnedFormDelivery(opts: { readonly path?: string; readonly baseUrl?: string } = {}): FormDelivery {
  const path = opts.path ?? '/api/contact';
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '');
  return {
    describe(o): FormDeliveryDescriptor {
      // action ASSOLUTO verso l'API centrale (il sito vive su *.pages.dev, l'API su brik):
      // un'action relativa colpirebbe pages.dev (404). Il pid identifica il progetto;
      // la destinazione email viene risolta lato server dal pid, non è nel form.
      const action = base ? base + path : path;
      let host = '';
      try { host = base ? new URL(base).host : ''; } catch { host = ''; }
      return { action, method: 'POST', hiddenFields: { pid: o.siteId }, endpointHost: host };
    },
  };
}
