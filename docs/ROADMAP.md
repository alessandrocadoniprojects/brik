# ROADMAP — brik

> Roadmap **prospettica** (cosa costruire), non retrospettiva come i `FASE*.md`. Ogni blocco = una Issue = un branch. L'Architect agent la legge con `VISION.md` per giudicare se un blocco serve il goal.
> Stato: `next` / `in-progress` / `review` / `done`. Default `next`.

## Precondizione (blocca tutto)
- **P0 — Allineamento prod↔git.** Committare/scartare i 7 file modificati su prod, ripulire la dir di deploy (segreti, zip, dati runtime fuori dalla web-root), ruotare la `.pem`. *Accettazione: `main` == produzione, niente file sensibili in `/opt/brik`.*

## Critical path — primo ricavo da agenzia
Il minimo perché un'agenzia possa pagare e consegnare siti senza brand brik.

- **B1 — White-label grigio sull’output. `done` (2026-06-23).** Verificato sul codice: URL pubblicato (`*.pages.dev` via `projectNameOf`) neutro e HTML pubblicato senza marchio brik visibile (i soli `data-brik-*` nei form sono marker tecnici). Il flusso non usa un preview-link come superficie cliente. *Rifinitura futura: rinominare i marker `brik-*`. La parte fine-prova blocca-non-elimina e tracciata in B7.*
- **B2 — Metering modifiche + cap.** Contatore unico per account = "modifiche". **Build iniziale gratis e separato** (uno per account in trial, non consuma il budget). Trial = 10 modifiche / 0 pubblicati; ogni sito pubblicato sblocca 5 modifiche. *Accettazione: superato il cap, la modifica è bloccata con messaggio chiaro; pubblicazione bloccata in trial.* **Allowance modifiche: ILLIMITATE per ora (deciso 2026-06-24); si introduce un cap solo se i dati mostrano abuso reale.**
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


## Integrazioni e capacità sito (verificato 2026-06-23, post-lancio immediato)

- **B10 — Integrazioni: attivazione reale.** Verificato sul codice. REALI: email/form (Resend, POST a api.resend.com), Meta Pixel + Conversions API server-side, WhatsApp CTA, Google Maps + schema.org, video facade YouTube. DICHIARATI MA NON INIETTATI: `metaPixel` script client, `googleAds`, `analytics` — `legalProfile.ts:312-317` lo dice esplicitamente (brik li mette in policy ma non inserisce lo script). Blocco: iniettare davvero gli script dichiarati, dietro consenso. Gap aspettativa-realtà da chiudere subito dopo il lancio.
- **B11 — Multilingua IT/EN.** Confermato ASSENTE (zero i18n/hreflang nel codice). Entrambi i siti del designer di riferimento sono IT/EN. Richiesta ricorrente clienti seri. Blocco medio. Post-lancio.
- **B12 — Consent banner GDPR (accoppiato a B10).** `cookieMode` esiste (4 livelli: technical-only/basic-analytics/full-analytics/marketing-pixel) ma `legalProfile.ts:317` segnala che oggi NON c'è il blocco-degli-script-prima-del-consenso. Necessario appena si attiva B10: se inietti pixel/ads servi il banner che li blocca prima dell'accettazione. Post-lancio, insieme a B10.

> Nota motion/animazioni: la fedeltà ai design (incluso il movimento) NON si fa con token-theme/reskin (forzerebbe i design nei layout di brik). Si fa col sorgente del designer come template, congelato as-is, parametrizzando solo le regioni di contenuto (slotting). Vedi Track M.

> **Design marketplace — intake designer (deciso 2026-06-24):** i designer caricano il **sorgente** del sito (non solo URL/screenshot). Il sorgente abilita la fedeltà piena — token + struttura sezioni + movimento — perché brik compone dal kit di sezioni del designer invece di ridipingere le proprie. NB: questo riguarda la fedeltà del design, NON il tracking analytics/pixel del sito generato (quello è B10, problema separato lato brik).