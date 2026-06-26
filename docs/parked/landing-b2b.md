# PARCHEGGIO — Landing B2B (rivenditori / white-label)

La versione B2B della superficie marketing — che parlava a **freelance marketing / agenzie** ("siti per i tuoi clienti", consegna white-label, piani multi-sito 19/39/79€) — è stata sostituita dal ritorno al **B2C** (singola attività, prezzo unico 4€/sito) il **2026-06-26** (`block/relaunch-b2c-flat`).

**Non è persa: è parcheggiata e reversibile.**

## Come ripristinarla
Lo stato B2B è catturato dal tag **`parked/landing-b2b`** (commit `80b1cc8`, pre-ritorno B2C). Per riportare le pagine marketing:

```bash
git checkout parked/landing-b2b -- web/index.html web/pricing.html web/how-it-works.html web/templates.html
```

(poi rivedere i prezzi: la B2B usava i 3 tier 19/39/79€ per-account — vanno riallineati a qualunque modello sia attivo al momento del ripristino).

## Cosa conteneva (per memoria)
- Hero: "Siti di alta qualità per i tuoi clienti, generati in minuti" + "consegni a tuo nome: nessun riferimento a Brik".
- Card "Senza marchio Brik" (white-label grigio).
- Pricing 3 tier: 19€/3 siti, 39€/10, 79€/30 ("siti online per i tuoi clienti").
- FAQ white-label: "Il sito mostra che è fatto con Brik?", "Posso gestire più clienti con un solo account?".
- Closing: "Consegna ai tuoi clienti siti di cui andare fieri."
- Footer: "Siti per i tuoi clienti… consegnati a nome tuo."

## Perché parcheggiata, non cancellata
Il white-label B2B resta tecnicamente valido (i siti pubblicati non portano marchio Brik) e potrebbe servire di nuovo come canale rivenditori. Decisione di posizionamento, non di prodotto-rotto → reversibile.
