# WhatsApp Sales Engine — Audit & Piano (Fase 1)

> Documento di audit del repository **brik** e proposta minima per il motore di
> vendita siti a ristoratori via **WhatsApp Cloud API**. Redatto prima di
> scrivere codice. Nessuna implementazione è stata avviata. Le decisioni bloccanti
> sono in fondo: **vanno chiuse prima della Fase 2**.

---

## 0. Vincoli operativi confermati (questa sessione)

- Sul VPS gira il batch `node /root/brik_gen_v4.mjs` (generazione siti). **Vietato**
  `systemctl restart brik` o fermare processi node finché l'operatore non autorizza.
- `AGENTS.md` → **Never**: toccare `/opt/brik/data/` (runtime live), `git merge`/`push` su
  `main`, `--force`, cancellare file. **Ask-first**: `.env`, `.gitignore`, `package.json`,
  nuove dipendenze, `src/core`. Il merge lo fa Ale via PR; il gate `reviewer` è obbligatorio.
- Un blocco = un branch `block/<id>` + spec da `docs/BLOCK_TEMPLATE.md` con **file dichiarati**.
- Baseline da non regredire: `typecheck` ZERO errori, `npm test` tutto verde.

---

## 1. Architettura attuale (reale, verificata)

| Aspetto | Realtà nel repo |
|---|---|
| **Runtime** | Node **v22.22.3**, **tsx** (nessun build step). ESM (`"type":"module"`), import con estensione `.js` su sorgenti `.ts`. |
| **Linguaggio** | TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitOverride`. Path alias `@core`, `@adapters`, `@orchestrator`. |
| **Architettura** | Esagonale: `src/core` (porte/dominio/Result), `src/adapters` (LLM, hosting, immagini, form), `src/intake`, `src/orchestrator`, `src/project`, `src/qa`, `src/server`. Frontend vanilla in `web/`. |
| **Server** | **Un unico** `src/server/server.ts` (~2346 righe) su `node:http` (`createServer`). Routing manuale: catena di `if (path === ... && method === ...)`. Nessun framework (no Express/Fastify). |
| **Database** | **Nessun DB**. Persistenza su **file JSON in `data/`**, scrittura atomica `tmp`+`rename`. Store: `siteStore.ts`, `accountStore.ts`, `localHosting.ts`, `auth.ts`. Append-only JSONL per i transcript chat (`appendChat`/`readChat`, `server.ts:104-142`). |
| **Auth** | Passwordless **magic-link** (`src/server/auth.ts`), sessioni via cookie, token `randomBytes(32).hex`. Operatori = `OPERATOR_EMAILS` (env). Endpoint admin protetti da `sessionUserOf(req)` + `isOperator`. `AUTH_REQUIRED` OFF di default. |
| **Deploy** | systemd unit `brik.service`, `ExecStart=tsx --env-file=.env src/server/server.ts`. Siti prospect serviti dal VPS su `<sub>.thebrik.it` (local hosting), clienti paganti su Cloudflare Pages. |
| **Logging** | Solo `console.log`/`console.error`. Convenzione prefissi: `  ✓` ok, `  ✗` errore, `  ⚠` warn, `  →` step, `  !` anomalia. Serializzatore unico `errStr(e)` = solo `e.message`. **Nessun logger strutturato, nessuna redazione segreti** (mitigazione: si logga solo `.message`, mai l'oggetto/gli header). |
| **Test** | `node:test` nativo via `tsx --test test/*.test.ts`. Solo **funzioni pure**, offline, `assert/strict`. Nessun avvio server, nessun HTTP reale, nessuna libreria di mock. La logica testabile viene **estratta in funzioni pure** (es. `maxPublishedForSubscription`), l'handler HTTP resta sottile. |
| **Env** | `process.env.X ?? default` sparso in testa a `server.ts`. Booleani via regex `/^(1|true|yes|on)$/i`. Flag `_READY` derivati (`STRIPE_READY`). Degrado graceful (feature OFF + log allo startup); solo `ANTHROPIC_API_KEY` è fatale (`process.exit(1)`). |
| **Rate limiting** | In-memory sliding-window: `leadRateOk` (8/10min per IP, `server.ts:516-530`), `anonGenAllowed` (`ANON_GEN_PER_IP_HOUR`). Si azzerano al restart. |
| **Job scheduling** | **Nessuno scheduler/coda/broker.** Solo sweep in-process con `setInterval` (es. lock sweep `LOCK_SWEEP_MINUTES`, prune chat). Questo è il meccanismo da riusare per il follow-up. |

### Webhook e pagamenti già presenti
- **Stripe** cablato: `POST /api/stripe/webhook` (`server.ts:1580-1619`) con **verifica firma** `stripe.webhooks.constructEvent` su **raw body** (`readRawBody`, `server.ts:282-294`). Gestisce `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed`. Il checkout (`server.ts:1896-1917`) usa `client_reference_id: <siteId>` e `subscription_data.metadata.email`. → **link acquisto→sito già disponibile** via `client_reference_id`.
- **Meta Conversions API** già integrata (`sendMetaCapi`, `server.ts:181-202`) verso `graph.facebook.com/**v21.0**`. → precedente d'uso della Graph API e della versione.

### Analytics/metriche già presenti
- `data/metrics.json` a **bucket orari** (`metricInc`/`catInc`, `sumRange`, `server.ts:426-479`).
- Funnel esistente: `views, visitors, promptStarted, created, edited, login, published`.
- `GET /api/metrics` (solo operatori) → funnel + categorie + serie giornaliera. Dashboard operatore in `web/app.js:3517`.
- `POST /api/ev` accetta **solo** `promptStarted`. → estendibile con nuovi contatori via `metricInc`.

---

## 2. Componenti riutilizzabili (non reinventare)

| Serve per | Riuso concreto |
|---|---|
| Persistenza lead/messaggi/eventi | Pattern **file-JSON atomico** (`siteStore.ts`) + **append JSONL** (`appendChat`). |
| Idempotenza webhook | Creazione file atomica (esistenza = già processato), come `randToken`→file in `auth.ts`. |
| Verifica firma HMAC | `readRawBody` (`server.ts:282`) già pronto; `node:crypto` (`createHmac`/`timingSafeEqual`) disponibile (oggi non usato). Precedente: firma Stripe. |
| Chiamate Graph API | `fetch` nativo (già usato in `sendMetaCapi`), versione `v21.0` come riferimento. |
| Tracking / contatori | `metricInc(event,n)` + bucket orario + `sumRange`. Token opachi: pattern `randomBytes(n).hex` + validazione regex. |
| Redirect | Precedente 302 nel verify magic-link (`server.ts:1457`). |
| Classificazione AI (fallback) | `makeAnthropicClassifier` / `makeAnthropicLLM` già cablati (`server.ts:255-256`). |
| Auth azioni admin | `sessionUserOf` + `isOperator` (identico agli endpoint `/api/admin/*`). |
| Dashboard | Shell operatore esistente in `web/app.js` + `web/index.html` (estendere, non ridisegnare). |
| Link acquisto→lead | Stripe checkout `client_reference_id`/`metadata` già presenti. |
| Numero E.164 dei ristoranti | `PizzeriaBusinessProfile.phone` (`pizzeriaProfile.ts`) + testo in `spec.description` + **CSV sorgente** (vedi Gap). |
| URL pubblico (landing) | `state.url` = `https://<sub>.thebrik.it` (`localHosting.ts:27`, `BASE_DOMAIN`). |
| URL preview | `GET /preview/:id` (`server.ts:1144`). |

---

## 3. Gap (cosa manca davvero)

1. **Nessun modello lead/customer/prospect strutturato.** `"prospect"` è solo un'etichetta nei commenti; `"lead"` è solo il rate-limiter; `"customer"` è solo Stripe. → **Va creato `SalesLead`/`SalesMessage`/`SalesEvent`**.
2. **`contactName` (referente) non esiste.** Nei CSV il campo `nome` è l'**insegna**, non una persona. → serve fallback neutro (decisione D2).
3. **`screenshotUrl` non esiste.** Nessuna cattura del sito; l'unico `og:image` è la **prima foto stock** dell'HTML, non uno screenshot. Playwright è già dipendenza ma pesante e il batch è in corso. → decisione D3.
4. **Fonte lead fuori dal repo e fuori da `data/`:** i dati ricchi stanno in `/root/data500*.csv` (header `row;nome;cat;localita;indirizzo;tel;maps;sub;query`) e `/root/results500c.csv` (header `row;nome;id;url_pubblico;entitled;status`, **211 righe** = mini-CRM già pronto: lead→siteId→url_pubblico→stato). → serve un **importer idempotente** (decisione D4).
5. **Nessun connettore WhatsApp**, nessun endpoint `/api/whatsapp/*`, nessuna env WhatsApp.
6. **Nessuno scheduler** per il follow-up (solo `setInterval` in-process → riusabile).
7. **Nessuna landing "99€/anno" dedicata** né `checkoutUrl` per il prodotto ristoratore (decisione D1 + D5).
8. **Nessuna verifica firma `X-Hub-Signature-256`** (Meta) — da implementare con `node:crypto`.
9. **Nessuna redazione segreti nei log** — accettabile oggi perché si logga solo `.message`; da rispettare nei nuovi moduli.

---

## 4. Rischi

| Rischio | Mitigazione proposta |
|---|---|
| Contatto marketing non richiesto a ristoranti (compliance Meta/GDPR) | Base giuridica + provenienza numero + opt-out → **decisione legale D6**; guardrail tecnici: `doNotContact`, STOP, feature flag, allowlist staging, dry-run. |
| Invio massivo accidentale | MVP: **solo invio manuale** dal pannello, un lead per volta. Niente campagne. Dedup + guardrail. |
| Token Meta esposto/loggato/committato | Env-only, mai al frontend, mai in git (`.gitignore` copre `.env`), log solo `errStr`. `.env.example` senza valori reali. |
| Screenshot generato durante il batch (Playwright pesante) | Generazione lazy/on-demand e cache su disco, **off-batch**; o riuso og:image (D3). |
| Doppio invio / doppia risposta a stesso evento | Idempotenza via `WebhookReceipt` (hash stabile) + dedup su stato lead. |
| Un elemento malformato fa fallire tutto il webhook | Try/catch per singolo `entry/change`, 200 rapido sempre, log del singolo scarto. |
| Scrittura in `data/` (vietata a mano) | I nuovi record vivono in **`data/sales/`** creata **a runtime dal codice** (gitignored), **nessuna** modifica manuale ai dati esistenti. |
| AI che improvvisa prezzi/offerte | L'AI **classifica soltanto** (JSON strutturato); le risposte al cliente sono **testi deterministici** da `salesPolicy`. Mai testo libero AI verso il cliente. |
| Versione Graph API deprecata | `WHATSAPP_GRAPH_API_VERSION` configurabile; **verificare la versione supportata sulla doc ufficiale Meta in fase di implementazione** (riferimento attuale nel repo: v21.0). |

---

## 5. Proposta minima (confine pulito: sales workflow ↔ connettore WhatsApp)

**Principio:** la logica commerciale sta in brik (state machine + policy + classifier),
WhatsApp è **solo trasporto** (client isolato che riceve dati già validati). Niente
microservizi, niente coda esterna, niente nuovo frontend. Persistenza sul file-store esistente.

### 5.1 Modello dati (nuovo store file-JSON, `data/sales/`)
- `SalesLead` → `data/sales/leads/<leadId>.json` (uno per lead). Campi: `id, businessName, contactName?, phoneE164, siteId, previewUrl, screenshotUrl, landingUrl, checkoutUrl?, channel, status, conversationMode, lastIntent?, lastInboundAt?, lastOutboundAt?, followUpAt?, followUpCount, doNotContact, assignedTo?, createdAt, updatedAt`.
- `SalesMessage` → append JSONL `data/sales/messages/<leadId>.jsonl` (`direction, channel, providerMessageId?, messageType, templateName?, body?, mediaUrl?, deliveryStatus?, providerRef?, createdAt`). **Payload grezzo non salvato integralmente**: solo campi utili + eventuale ref/hash.
- `SalesEvent` → append JSONL `data/sales/events/<leadId>.jsonl` (`eventType, metadata{JSON limitato, non sensibile}, occurredAt`).
- `WebhookReceipt` → file `data/sales/receipts/<providerEventId>.json` (esistenza = idempotenza; `processedAt, result`).
- Indice reverse **telefono→lead** per l'inbound: `data/sales/by-phone/<phoneE164>.json`.
- Token tracking opachi: `data/sales/tokens/<token>.json` → `{ leadId, kind }` (`randomBytes(16).hex`).

### 5.2 State machine (modulo unico, puro)
Stati: `NEW, SITE_READY, READY_TO_CONTACT, WHATSAPP_SENT, WHATSAPP_DELIVERED, WHATSAPP_READ, RESPONDED, INTERESTED, LANDING_OPENED, CHECKOUT_OPENED, PURCHASED, CUSTOMIZATION_REQUESTED, HUMAN_HANDOFF, NOT_INTERESTED, DO_NOT_CONTACT, FAILED`.
Transizioni valide in **un solo modulo** `salesState.ts` (mappa `Record<Status, Status[]>`), transizioni arbitrarie rifiutate. Testato con funzioni pure.

### 5.3 Connettore WhatsApp (adapter isolato)
`src/adapters/whatsapp/client.ts`: `sendTemplateMessage()`, `sendTextMessage()`, `markMessageAsRead()`. Timeout, retry limitato solo su errori transitori, **error mapping tipizzato**, logging sicuro, supporto header-immagine + variabili body + bottone/link. **Nessuna logica commerciale**: riceve dati già validati. Nome template configurato/validato via env, mai assunto esistente.

### 5.4 Webhook Meta
`GET /api/whatsapp/webhook` (verify token) + `POST` (firma `X-Hub-Signature-256` su raw body con `META_APP_SECRET`, 200 rapido, idempotente, gestione difensiva per elemento). Handler sottili in `server.ts`, parsing/verifica in modulo dedicato `whatsappWebhook.ts` (puro, testabile).

### 5.5 Classificatore ibrido + policy deterministica
`salesClassifier.ts`: **regole prima** (PRICE/POSITIVE/NEGATIVE/CUSTOMIZATION/HUMAN_REQUEST/GREETING/STOP/UNKNOWN), AI (`makeAnthropicClassifier`) **solo** sotto soglia di confidenza, con JSON strutturato e fallback sicuro. `salesPolicy.ts`: intent → **testo deterministico** (mai AI libera). CUSTOMIZATION/UNKNOWN → human handoff; NEGATIVE/STOP → blocco contatti.

### 5.6 Invio manuale + follow-up singolo
`salesSend.ts`: `sendInitialRestaurantOffer(leadId)` con tutti i guardrail (E.164, screenshot HTTPS pubblico, stato `READY_TO_CONTACT`, `doNotContact=false`, `WHATSAPP_ENABLED`, allowlist staging, dedup, dry-run, risultato tipizzato). **Un solo follow-up** via sweep `setInterval` in-process (riuso del pattern lock-sweep), con tutte le condizioni (consegnato, nessuna risposta/acquisto, non-human, `followUpCount<1`).

### 5.7 Tracking + dashboard
`salesTracking.ts`: `/api/whatsapp/t/:token` registra `PREVIEW_OPENED`/`LANDING_OPENED`/`CHECKOUT_OPENED` e fa 302 (non blocca la navigazione, nessun dato personale nell'URL). `PURCHASED` collegato estendendo il **già presente** handler Stripe via `client_reference_id`/`metadata`. Dashboard: nuovo pannello "Vendite WhatsApp" in `web/app.js` + endpoint `/api/sales/*` (solo operatori), riuso di `metricInc`/`sumRange` per le metriche.

---

## 6. File reali da toccare (dichiarazione, per la spec del blocco)

**Nuovi (src):**
- `src/adapters/whatsapp/client.ts` — WhatsAppClient (trasporto).
- `src/adapters/whatsapp/types.ts` — payload/errori tipizzati.
- `src/server/salesConfig.ts` — lettura+validazione env WhatsApp, flag `WHATSAPP_READY`.
- `src/server/salesStore.ts` — persistenza lead/message/event/receipt/token/index.
- `src/server/salesState.ts` — state machine pura.
- `src/server/salesClassifier.ts` — classificazione ibrida.
- `src/server/salesPolicy.ts` — risposte deterministiche.
- `src/server/salesSend.ts` — invio iniziale + follow-up.
- `src/server/salesTracking.ts` — token opachi + eventi + target redirect.
- `src/server/whatsappWebhook.ts` — verifica firma + parsing payload (puro).
- *(condizionale D3)* `src/server/siteScreenshot.ts` — cattura+cache screenshot.

**Modifiche (esistenti):**
- `src/server/server.ts` — wiring rotte (`GET/POST /api/whatsapp/webhook`, `/api/whatsapp/t/:token`, eventuale `/api/whatsapp/shot/:token`, `/api/sales/*`), sweep follow-up, link acquisto→lead nel webhook Stripe (additivo, non distruttivo).
- `web/app.js`, `web/index.html` — pannello "Vendite WhatsApp" (additivo).
- `web/offerta.html` — **landing fornita dall'operatore** (base64), da **posizionare** in `web/` e con
  placeholder `STRIPE_PAYMENT_LINK`/`WHATSAPP_LINK` sostituiti. Non generata da me.
- `.env.example` — documenta le nuove env **senza valori reali** *(Ask-first: modifica file di config)*.

**Test (nuovi):** `test/salesState.test.ts`, `test/salesClassifier.test.ts`, `test/salesPolicy.test.ts`, `test/salesSend.test.ts`, `test/whatsappSignature.test.ts`, `test/salesTracking.test.ts`, `test/salesStore.test.ts` (idempotenza).

**Docs (Fase 14):** `docs/WHATSAPP_SALES_ENGINE.md`, `WHATSAPP_META_SETUP.md`, `WHATSAPP_RUNBOOK.md`, `WHATSAPP_RELEASE_CHECKLIST.md`.

**Script (condizionale D4):** importer idempotente CSV→`data/sales/leads/*` (letto da `/root/results500c.csv` + `/root/data500*.csv`).

---

## 7. Dipendenze strettamente necessarie

**Zero nuove dipendenze runtime.** WhatsApp via `fetch` nativo; firma via `node:crypto`;
screenshot (se D3=genera) via `playwright` **già presente**. Nessuna coda/broker/framework.

---

## 8. Piano di rollback

- Tutto **additivo**: nuovi file + rotte nuove + nuova cartella `data/sales/` (runtime, gitignored). **Nessuna migrazione** su dati esistenti, **nessuna** modifica ai siti/owner/account.
- Interruttore immediato: `WHATSAPP_ENABLED=false` (default) blocca ogni invio senza deploy.
- Rollback codice: `git revert`/checkout del branch `block/<id>`; i dati `data/sales/` restano inerti e ignorabili.
- Il webhook Stripe resta retro-compatibile: la parte "link acquisto→lead" è un ramo aggiuntivo che degrada a no-op se il lead non esiste.

---

## 9. Ordine di implementazione (fasi del prompt → blocchi)

1. **C** Modello dati + store (`salesStore`, `salesState`) + test.
2. **B/config** `salesConfig` (env, validazione, flag) + `.env.example`.
3. **D** Connettore `whatsapp/client` + types + test error-mapping (mock HTTP).
4. **E** Webhook GET/POST + firma + idempotenza + test firma valida/invalida/duplicato.
5. **G/H** Classificatore + policy deterministica + test intent.
6. **I** `sendInitialRestaurantOffer` + guardrail + dry-run + allowlist + azione manuale dashboard.
7. **J** Tracking link + eventi + link acquisto→lead (Stripe).
8. **K** Dashboard minima (pannello + metriche).
9. **L** Follow-up singolo (sweep).
10. **M/N/O** Test completi, documentazione, release checklist.

Dopo ogni fase: `npm run typecheck` + test pertinenti, mostrare file modificati, segnalare rischi, gate `reviewer` a fine blocco.

---

## 10. Decisioni (stato)

- **D1 — Prezzo → CHIUSA: 99€/anno tutto compreso.** Testi di policy e landing usano "99 EUR
  all'anno". Serve un **price/checkout dedicato** a questa offerta (probabile nuovo price Stripe
  **annuale**, distinto dall'abbonamento 19€/mese esistente). Da configurare via env in fase impl.
- **D2 — `contactName` → default: fallback neutro.** `{{1}}` usa un saluto neutro ("Ciao,") quando
  il referente manca (caso normale: `nome` = insegna). Campo `contactName?` resta valorizzabile a
  mano dal pannello per i lead in cui è noto. *(Non bloccante; confermabile in corsa.)*
- **D3 — `screenshotUrl` → CHIUSA: generazione Playwright on-demand + cache.** Nuovo modulo
  `src/server/siteScreenshot.ts`: cattura lazy e **off-batch**, PNG su disco (`data/sales/shots/`),
  servito via rotta pubblica HTTPS (`/api/whatsapp/shot/:token`) per l'header del template Meta.
- **D4 — Ingestion → CHIUSA: sì, importer idempotente.** Script che legge `/root/results500c.csv`
  + `/root/data500*.csv`, normalizza il telefono in **E.164**, crea/aggiorna i `SalesLead` in
  `data/sales/` senza duplicati (rilanciabile).
- **D5 — Landing → CHIUSA: file fornito dall'operatore, da posizionare (NON da scrivere).**
  L'operatore fornisce l'HTML completo (design system Brik **dark**, sezioni hero / prezzo 99€ / FAQ)
  con i placeholder **`STRIPE_PAYMENT_LINK`** e **`WHATSAPP_LINK`** già predisposti. Consegna via
  base64. Il mio compito: **posizionarlo in `web/`** (es. `web/offerta.html`), servirlo come le altre
  pagine statiche, e **sostituire i due placeholder** (Stripe Payment Link dei 99€/anno; link WhatsApp).
  Il `checkoutUrl` per-lead tracciato punta a questo Payment Link. **Nessuna generazione di landing.**
- **D6 — Compliance/legale → APERTA (non blocca il codice, blocca l'invio reale).** Base giuridica,
  provenienza del numero, informativa privacy, opposizione, conservazione, consenso, policy Meta
  (categoria *marketing*). Decisione di Ale; documentata in `WHATSAPP_SALES_ENGINE.md` (Fase 14).
- **D7 — Template Meta + numero → APERTA (blocca l'invio reale, non il codice).**
  `restaurant_site_preview_v1` non è assunto esistente: nome/lingua/variabili devono corrispondere
  al template **approvato**; Phone Number ID/WABA/token forniti dall'operatore; test → reale solo a
  checklist completa. Il codice valida il nome template via env e supporta dry-run.

### Impatto sullo scope (decisioni chiuse)
- **+** `src/server/siteScreenshot.ts` + rotta `/api/whatsapp/shot/:token` (D3).
- **+** script importer `scripts/importSalesLeads.ts` (o `demo/`), letto da `/root/*.csv` (D4).
- **+** Landing `web/offerta.html` **fornita dall'operatore** (da posizionare, non scrivere): sostituire
  i placeholder `STRIPE_PAYMENT_LINK` / `WHATSAPP_LINK` + wiring nella catena statica di `server.ts`.
  Price/Payment Link Stripe annuale dedicato ai 99€/anno da configurare (D1, D5).

---

*Fine Fase 1. D1/D3/D4/D5 chiuse. D6/D7 aperte ma non bloccano l'implementazione del codice
(bloccano solo l'invio reale, protetto da `WHATSAPP_ENABLED=false` + dry-run + allowlist).*
In attesa del via libera esplicito per iniziare la Fase 2 (modello dati).
