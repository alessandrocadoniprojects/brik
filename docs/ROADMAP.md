# ROADMAP — brik

> Roadmap **prospettica** (cosa costruire), non retrospettiva come i `FASE*.md`. Ogni blocco = una Issue = un branch. L'Architect agent la legge con `VISION.md` per giudicare se un blocco serve il goal.
> Stato: `next` / `in-progress` / `review` / `done`. Default `next`.

## Precondizione (blocca tutto)
- **P0 — Allineamento prod↔git.** Committare/scartare i 7 file modificati su prod, ripulire la dir di deploy (segreti, zip, dati runtime fuori dalla web-root), ruotare la `.pem`. *Accettazione: `main` == produzione, niente file sensibili in `/opt/brik`.*

## Critical path — primo ricavo da agenzia
Il minimo perché un'agenzia possa pagare e consegnare siti senza brand brik.

- **B1 — White-label grigio (quasi-zero).** I siti pubblicati non portano marchio brik (confermato: nessun badge oggi). Resta: rendere **neutro/a marchio agenzia il preview link**, e gestire la fine prova come **blocco, non eliminazione** (si lega a B7). *Accettazione: il preview di un sito non contiene "brik"; a fine trial il sito non viene cancellato ma bloccato.*
- **B2 — Metering modifiche + cap.** Contatore unico per account = "modifiche". **Build iniziale gratis e separato** (uno per account in trial, non consuma il budget). Trial = 10 modifiche / 0 pubblicati; ogni sito pubblicato sblocca 5 modifiche. *Accettazione: superato il cap, la modifica è bloccata con messaggio chiaro; pubblicazione bloccata in trial.*
- **B3 — Billing agenzia (Stripe).** €9/mese per sito pubblicato, fatturato all'agenzia. Stripe è già dipendenza. *Accettazione: pubblicare un sito attiva un addebito ricorrente di €9/mese; dispubblicare lo ferma.*

## Tema — Onboarding & velocità
- **B4 — Import-da-URL (verifica/fix, non da zero).** Esiste `src/server/htmlImport.ts` + lavoro recente; va verificato che funzioni davvero, poi rifinito. *Accettazione: dato un URL, brik estrae contenuti/asset utilizzabili nella generazione.*
- **B5 — Import asset brand del cliente.** Per sito: caricare logo/colori/font/immagini del brand esistente (o estrarli via `htmlImport`) e passarli alla generazione. Il campo `brandKit` è già predisposto nel modello. *Accettazione: gli asset caricati compaiono nel sito generato al posto dei default.*

## Tema — Gestione multi-cliente
- **B6 — Dashboard v1 (lista).** Vista a lista dei siti dell'account; per sito: etichetta cliente (campo nuovo), stato (bozza/preview/pubblicato), URL live, generazioni usate/rimaste; azioni rapide: apri, copia preview link, pubblica/dispubblica. *Accettazione: da una schermata vedo tutti i siti e pubblico/dispubblico senza entrare nel singolo progetto.* (Filtro/raggruppa per cliente: fuori v1.)

## Tema — Sicurezza di gestione
- **B7 — Lock invece di delete** per i progetti non pubblicati (oggi vengono cancellati). *Accettazione: un progetto non pubblicato sotto soglia viene bloccato, non eliminato.*
- Gate **QA / SECURITY_SCAN** esistenti: mantenuti come garanzia di reputazione, nessuna regressione.

## Tema — Debito & performance
- **B8 — Fix azioni form esterne** sui progetti app-style.
- **B9 — Parallelizzare la generazione delle route al publish** (oggi sequenziale, ~111s per 3 route; `completePages` è già parallelo, usarlo come riferimento). Conta di più ora che si costruisce a volume.

## Fuori da v1 (esplicito)
Membri team, login/account cliente finale, analytics per cliente, e-commerce, white-label di piattaforma, sviluppo del path one-shot diretto.

---
*Parametri tarabili: numero di modifiche (trial 10, sblocco 5 per sito pubblicato), build iniziale gratis, e prezzo (€9) sono valori di partenza, non vincoli architetturali.*
