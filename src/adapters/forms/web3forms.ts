/**
 * Adapter di recapito form: Web3Forms (https://web3forms.com).
 *
 * Recapito email per form su siti statici, senza backend: il form fa POST a
 * api.web3forms.com con un access_key (gratuito, legato a un'email di destinazione).
 * Sostituibile dietro la porta FormDelivery; in futuro un adapter "di proprieta"
 * (Cloudflare Functions + provider email) senza dipendenze esterne.
 *
 * Credenziale (impostata dall'utente, MAI nel codice):
 *   WEB3FORMS_ACCESS_KEY  chiave creata su web3forms.com per l'email del cliente
 */
import type { FormDelivery, FormDeliveryDescriptor } from '@core';

export function makeWeb3FormsDelivery(config: { readonly accessKey?: string; readonly fromName?: string } = {}): FormDelivery {
  const accessKey = config.accessKey ?? process.env.WEB3FORMS_ACCESS_KEY;
  return {
    describe(opts): FormDeliveryDescriptor {
      if (!accessKey) {
        // senza chiave non si recapita: il form mostra solo la conferma (fallback statico)
        return { action: '#', method: 'POST', hiddenFields: {}, endpointHost: '' };
      }
      const hiddenFields: Record<string, string> = {
        access_key: accessKey,
        subject: opts.subject ? `Nuovo messaggio dal sito: ${opts.subject}` : 'Nuovo messaggio dal sito',
      };
      if (config.fromName) hiddenFields.from_name = config.fromName;
      return { action: 'https://api.web3forms.com/submit', method: 'POST', hiddenFields, endpointHost: 'api.web3forms.com' };
    },
  };
}
