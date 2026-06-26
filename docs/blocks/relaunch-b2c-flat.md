# block/relaunch-b2c-flat — Marketing B2C + pricing 4€ (copy) + parcheggio B2B

**Tipo:** solo copy/markup HTML statico (superficie marketing) + parcheggio + doc. Nessun cambio funzionale/backend. (Il billing 4€ vero è un blocco a parte: B-PRICE.)

## Obiettivo
Pivot del posizionamento pubblico: dal B2B (freelance/agenzie, white-label, piani 19/39/79€) di nuovo al **B2C** (la singola attività crea il proprio sito vetrina senza saper programmare, con tutte le integrazioni) + **prezzo unico 4€/mese per sito**. Il B2B va **parcheggiato** (reversibile), non perso.

## File
- `web/index.html` — head (title/meta/og), hero, "Tutto incluso" (card "Senza marchio Brik" → "Integrazioni incluse"), sezione prezzo (3 tier → card unica 4€), FAQ (via le 2 white-label, dentro costo/integrazioni/24h), closing, footer.
- `web/pricing.html` — head, hero, prezzo unico 4€, FAQ, closing, footer.
- `web/how-it-works.html`, `web/templates.html` — stringhe condivise (footer tagline, CTA "Inizia", closing band B2C).
- `docs/parked/landing-b2b.md` (nuovo) + tag `parked/landing-b2b` — parcheggio.
- `docs/VISION.md` (nota pivot B2C), `docs/ROADMAP.md` (B-B2C done + B-PRICE/B-TRIAL24 next), `docs/blocks/relaunch-b2c-flat.md` (spec).

## Criterio di accettazione
1. Tutta la superficie marketing parla alla **singola attività** (niente "tuoi clienti"/rivenditore/white-label).
2. Pricing = **prezzo unico 4€/mese per sito** ovunque (niente 19/39/79€, niente 3 tier). Card prezzo singola e centrata (verificata via screenshot, non rotta).
3. Messaggio chiave: sito vetrina **senza saper programmare** + **integrazioni incluse** (contatti/mappa/WhatsApp/orari/social).
4. Modello prezzo descritto coerente col nuovo flusso: build/prova gratis → 24h dal vivo dopo il publish → 4€/mese o offline.
5. B2B **parcheggiato** e ripristinabile: tag `parked/landing-b2b` + `docs/parked/landing-b2b.md` con istruzioni.
6. Nessun residuo B2B/vecchi prezzi in `web/*.html` (grep pulito).
7. Solo copy/markup: nessun cambio a logica/JS/backend (le icone SVG e la card prezzo sono markup).

## Note
- Il billing reale (Stripe 4€, gate, trial 24h) NON è in questo blocco: è B-PRICE + B-TRIAL24. Qui la copy descrive il modello-bersaglio; i due blocchi backend lo rendono vero subito dopo.
