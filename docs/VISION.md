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
- **Superficie di marketing allineata (2026-06-26).** Landing, `/pricing`, `/how-it-works` e `/templates` parlano esplicitamente al **rivenditore** (freelance marketing/agenzie): siti per i *propri clienti*, consegnati a nome dell'agenzia, nessun riferimento a brik; i piani multi-sito sono descritti come "siti online per i tuoi clienti". Prima la copy era ancora B2C ("il sito della tua attività"). (`block/landing-copy-b2b`)
- **Onboarding senza doppi-passaggi.** Il box d'ingresso pone già la prima domanda reale dell'intake (l'attività); una descrizione sufficiente implica il path "scrivo io" e salta lo step "Da dove vuoi partire?", che resta per chi parte da un sito/social esistente. L'agenzia entra in pochi secondi, senza che le stesse informazioni siano chieste due volte. (`block/hero-firststep`)
- **Landing snella per il pubblico pro.** L'explainer base "Come funziona" (3 step) è stato tolto dalla landing: per un addetto ai lavori è ridondante. Resta sulla pagina dedicata `/how-it-works`, linkata da nav e footer. (`block/landing-remove-howitworks`)

## Modello di prezzo (orienta le scelte di prodotto)
- **Modello per-account a tier (live 2026-06-24).** Abbonamento mensile ricorrente, non lineare: **19€ = 3 siti pubblicati**, 39€ = 10, 79€ = 30. L'unità che si paga è lo *slot di pubblicazione* dell'account (`maxPublished`), non il singolo sito. Tier accesi via env (`STRIPE_PRICE_BASE/PLUS/PRO`); tutti e 3 attivi al lancio.
- **Build iniziale gratis e separato**: non consuma budget. Genera e modifica sono liberi anche in trial.
- **Trial gratis**: nessuna carta, **0 pubblicazioni** finché il piano non è attivo. Si costruisce e si valuta la qualità; pubblicare = consegnare al cliente = si paga. Lock del trial dopo **3 giorni** (`TRIAL_DAYS`).
- **Modifiche illimitate per ora** (`EDIT_CAP=0`): nessun cap sulle correzioni/rigenerazioni. Cap reintroducibile via env solo se i dati mostrano abuso — scelta strategica, non architetturale.
- **Disdetta**: i siti già pubblicati restano online (il gate scatta solo alla pubblicazione di un nuovo slot); l'account non può pubblicarne di nuovi finché non riattiva.
- Unit economics: build ~€0,60, modifica ~€0,02, hosting ~€0 → margine dominante. Strategia: entrare cheap per diventare lo strumento-status del freelance, poi alzare i prezzi grandfatherando gli early adopter.

## Non-goals (filtro anti-scope-creep)
- **No** editor visuale tipo Duda.
- **No** account/login per il cliente finale.
- **No** e-commerce.
- **No** white-label di piattaforma (dominio/builder rebrandizzati) in v1 — solo grigio.
- **Non** investire nel vecchio path one-shot diretto all'attività: resta funzionante, non si sviluppa.

## Principio di qualità
La reputazione di ogni sito è dell'**agenzia**, non di brik. La qualità (nessun placeholder pubblicato, fedeltà al design system, gate QA/Security) è un requisito di vendita, non un nice-to-have. Vale anche per le **superfici di scelta in Studio**: il catalogo stili usa "Style Preview Cards" (moodboard CSS coerenti) invece di screenshot reali scalati — un'agenzia sceglie da un catalogo che sembra premium e intenzionale. (`block/style-catalog-preview-cards`)
