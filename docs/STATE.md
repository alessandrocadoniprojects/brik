# STATE — dove siamo adesso

> Doc di processo, leggibile in 30 secondi a inizio sessione. Aggiornalo a ogni step come la ROADMAP. Ultimo aggiornamento: **2026-06-24**.

## Critical path al ricavo
B1 ✓ → B2 ✓ (live) → **B3 ✓ lato codice** (gate REVIEWER PASS) → **LANCIO**.

## Ultimo blocco chiuso lato codice
**B3 — Billing Stripe per-account.** Stripe migrato da per-sito a per-account: price ricorrenti per tier → `maxPublished` (19€→3, 39€→10, 79€→30). Webhook `customer.subscription.*` alimenta il gate B2. Suite 312/312 verde, typecheck ZERO, gate REVIEWER PASS. Spec: `docs/blocks/B3_stripe_billing.md`.

## Decisione di scope e2e B3 (2026-06-24)
- **e2e RIDOTTO sul solo ponte Stripe.** Si verifica: evento `customer.subscription.created` (con `metadata.email` + price BASE) → `data/accounts/<email>.json` = `maxPublished 3`; `...deleted` → torna `0`. Il **gate del 4° publish NON si rifà e2e**: già coperto dagli unit B2 (3 build Playwright reali sarebbero costose e ridondanti).
- **Niente micro-blocco DATA_DIR** (scartato per velocità). L'isolamento dei dati si fa con un **git worktree** in `/opt/brik-staging` (HEAD detached sul commit B3): lì `../../data/` risolve in `/opt/brik-staging/data/`, vuota e separata dai dati live. B3 resta intatto, nessuna modifica a `src/`.
- Stripe CLI installata (`1.43.1`). Niente `stripe login` interattivo: la CLI usa `--api-key sk_test_…` direttamente.

## APERTO ORA (cosa manca prima del lancio)
1. **e2e B3 ridotto via ACQUISTO REALE** (Fase 3, in corso): niente staging/chiavi test (scartato). Ale fa un checkout reale sul suo account in prod (la prod gira già B3, confermato dal log avvio 18:11 `19€/mese -> 3 siti, per-account`) → io verifico `data/accounts/<email>.json` = `maxPublished 3`; poi Ale rimborsa+cancella da Dashboard → evento `deleted` → verifico torna a `0`. Stripe CLI `1.43.1` installata (non più necessaria per questo approccio).
2. **✅ Modal PLAN_LIMIT_REACHED — pulsante "Attiva piano"** (`block/checkout-cta`): IMPLEMENTATO, gate PASS. Copre il caso **senza piano** (maxPublished 0) → `startCheckout()` crea una subscription nuova (BASE). Solo `web/app.js`. In test live su prod. → manca la PR. (Il caso "ho già un piano e sono al limite" lo gestisce il blocco upgrade qui sotto.)
3. **🟢 Upgrade self-service VERO** (`block/plan-upgrade`, deciso 2026-06-25, prodotto-per-il-lancio): utente con piano attivo al limite → "Attiva piano" propone il **tier SOPRA** (3→10→30) e fa **upgrade della subscription esistente** (`stripe.subscriptions.update` con prorata), NON un checkout nuovo. Richiede: salvare `subscriptionId` nell'account (oggi salviamo solo `maxPublished`), endpoint `upgrade`, ladder tier lato server, frontend che distingue no-piano→checkout vs piano→upgrade. Webhook `subscription.updated` già aggiorna `maxPublished` al nuovo price (B3). **Base branch: `block/B3-stripe`** (NON main: il webhook per-account vive solo lì). Piano completo concordato con Ale. Gate REVIEWER.
4. **🟠 Account pagante vede ancora il banner trial** (`block/trial-banner-paid`): chip "🎁 Prova gratuita" (`web/app.js:1718-1720`) basato sul trial PER-SITO, si spegne solo con `st.entitled`; il frontend non riceve il piano account. Fix: `stateView` (`server.ts:633`) espone `planActive`/`maxPublished`; `web/app.js` mostra "Piano attivo" anche con `st.planActive`. Trial per i NON paganti: invariato. (Si appoggia allo stesso `stateView` esteso del blocco upgrade — valutare se unirli.)
5. **Landing + /pricing + pricing in-app: testi pricing** (`block/pricing-copy`, pre-lancio): landing, `/pricing` e pricing interno all'app ancora su 149€/49€. Solo copy. Stringhe in `web/app.js`: `:1687` "49€/anno", `:2320`/`:2325` "149€", `:111` `fbq value:149`. → 19€/3 siti (39€/10, 79€/30).
6. **Backup `.bak-b3` da rimuovere** dopo conferma e2e: `src/server/accountStore.ts.bak-b3`, `src/server/server.ts.bak-b3`, `docs/VISION.md.bak-b3`. (Vecchi `.bak-login-project-*`/`.bak-pizzerie-*`: a parte.)
7. **⚠️ STACK DI DIPENDENZE — main è indietro.** PR aperte da mergiare IN ORDINE: `block/B3-stripe` (billing per-account, base di tutto) → poi `block/gate-reviewer`, `block/checkout-cta`, `block/plan-upgrade`, `block/trial-banner-paid`, `block/pricing-copy`. **main non ha B3**: la prod gira B3 solo in memoria (boot 18:11). Un restart del service ORA caricherebbe main (codice per-sito vecchio) e perderebbe B3 → **non riavviare brik finché B3 non è su main**. Merge = Ale via PR.

## ⚠️ Aperto separato (non bloccante lancio, ma da sistemare)
- **Webhook Stripe doppio/secret errato**: nei log del 23:52 alcuni eventi passano la firma, altri danno `✗ No signatures found` con retry → probabile un secondo endpoint webhook sullo stesso URL con secret diverso (vecchio rimasto oltre a "charismatic-finesse"). Verificare in Dashboard → Webhooks e togliere il vecchio, altrimenti `subscription.updated/deleted` dall'endpoint sbagliato si perdono.
- **Account founder fuori scala**: `ale@atlantix.io` ha 33 siti pubblicati legacy → col piano da 3 il gate (`33<3=false`) blocca sempre. Non è un bug del billing: testare il flusso con email nuova (0 pubblicati). Per l'account founder serve decisione operatore separata.

## Branch aperti, non ancora mergiati (main è la verità, qui c'è cosa manca da PR-are)
- **`block/B3-stripe`** — il billing per-account: `src/server/accountStore.ts`, `src/server/server.ts`, `test/stripeWebhook.test.ts`, `docs/ROADMAP.md`, `docs/VISION.md`, `docs/blocks/B3_stripe_billing.md`. → PR di B3.
- **`block/gate-reviewer`** — il setup del processo: `AGENTS.md` (baseline reale + regola gate), `package.json` (`test` = suite completa `test/*.test.ts`), `docs/roles/02_IMPLEMENTER.md`, `.claude/agents/reviewer.md` (subagent), `.gitignore` (traccia `.claude/agents/`), `docs/STATE.md`. → PR del gate.
- Merge li fa **Ale via PR**. main è ancora a `b2aee60`, zero commit nuovi.

## Prossimo step
Fase 3: guidare l'e2e Stripe test-mode. A verde → rimuovere i `.bak-b3`, aggiornare STATE.md + ROADMAP, far passare dal gate REVIEWER. Poi: **lancio**. Dopo il lancio: B10 (script analytics/pixel non iniettati), B11 (multilingua IT/EN), B12 (consent banner GDPR). Track M: marketplace design.

## Baseline (verificata, NON riportarsi dietro vecchi miti)
- `npm run typecheck` → **ZERO errori**.
- `npm test` → **suite completa via `test/*.test.ts`, 312/312 verde**. Lista fallimenti-noti **VUOTA**; cresce solo con OK esplicito di Ale.
- **`site.test #19` è VERDE.** Il "debito storico" (`editProject … FA CRESCERE il contratto`) era **già risolto** in un commit passato: `ok 19`. Nessuna sessione futura lo riporti come rosso noto — non lo è.

## Gate di processo (attivo)
Ogni blocco passa il subagent `reviewer` (`.claude/agents/reviewer.md`) a context fresco prima di essere "chiuso". PASS ⇔ typecheck ZERO **E** suite senza fallimenti nuovi **E** accettazione **E** invarianti **E** no scope creep. Un branch per blocco; doc allineati nello stesso branch; main solo via PR di Ale. SECURITY/ARCHITECT/DOCKEEPER: role file pronti in `docs/roles/`, non ancora cablati come subagent (si aggiungono dopo che REVIEWER gira liscio — già validato 2026-06-24).
