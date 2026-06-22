# VISION — brik

> Documento di prodotto canonico. Lo legge l'**Architect agent** in fase di planning per decidere se un blocco serve il goal. Non è l'AGENTS.md (che resta magro): si apre on-demand.

## Cos'è brik
Lo strumento con cui i **consulenti / agenzie di digital marketing** generano, pubblicano e gestiscono velocemente e a basso costo siti vetrina per i loro clienti.

## Chi è il cliente
Il **rivenditore**: agenzia o consulente che già vende servizi di marketing al cliente finale e usa brik come strumento di produzione.

## Chi NON è il cliente
La **singola attività commerciale**. È il cliente *del* rivenditore, non di brik. Non ha account, non logga, non sa che dietro c'è brik. Non costruiamo feature pensate per il suo uso diretto.

## Cosa significa vincere
Un'agenzia costruisce e gestisce N siti vetrina in una frazione del tempo e del costo, li rivende col proprio marchio a margine alto, e non ha nulla da mantenere.

## Modello operativo
- **White-label grigio**: il cliente finale non vede mai "brik". I siti pubblicati non portano alcun marchio brik; l'unica superficie che il cliente vede (preview link) è neutra / a marchio agenzia.
- **Tutto in mano all'agenzia**: nessun login per il cliente finale in v1.

## Modello di prezzo (orienta le scelte di prodotto)
- **Unità unica: un sito pubblicato = €9/mese.** Lineare: 3 siti = €27, 50 siti = €450. Margine ovvio per chi rivende.
- **Contatore unico = "modifiche"** (correzioni/rigenerazioni parziali). Il **build iniziale è gratis e separato**: uno per account in trial, non consuma il budget.
- **Trial gratis**: nessuna carta, **build iniziale + 10 modifiche**, **0 pubblicazioni**. Basta per costruire un sito e vederne la qualità. Per pubblicare = consegnare al cliente = si paga.
- **Ogni sito pubblicato sblocca 5 modifiche** per la manutenzione post-pubblicazione (il sito esiste già, nessun nuovo build incluso). Pubblicare (ciò che paga) sblocca modificare (ciò che costa) → si auto-bilancia.
- **Niente fee di lancio, niente bundle** in v1. Esaurite le modifiche: allarga l'account.
- Costo interno ~€0,60 a build, modifiche più leggere → margine positivo garantito su ogni sito pubblicato.

## Non-goals (filtro anti-scope-creep)
- **No** editor visuale tipo Duda.
- **No** account/login per il cliente finale.
- **No** e-commerce.
- **No** white-label di piattaforma (dominio/builder rebrandizzati) in v1 — solo grigio.
- **Non** investire nel vecchio path one-shot diretto all'attività: resta funzionante, non si sviluppa.

## Principio di qualità
La reputazione di ogni sito è dell'**agenzia**, non di brik. La qualità (nessun placeholder pubblicato, fedeltà al design system, gate QA/Security) è un requisito di vendita, non un nice-to-have.
