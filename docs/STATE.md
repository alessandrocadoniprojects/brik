# STATE — dove siamo adesso

> Doc di processo, leggibile in 30 secondi a inizio sessione. Aggiornalo a ogni step come la ROADMAP. Ultimo aggiornamento: **2026-06-26**.

## Critical path al ricavo
B1 ✓ → B2 ✓ (live) → B3 ✓ (billing per-account) → **5 blocchi rifiniture pre-lancio ✓ (mergiati su main, server allineato)** → **LANCIO** (verifiche operative residue lato Dashboard/Ale).

## ✅ FATTO 2026-06-26 — 5 blocchi rifiniture chiusi, upgrade validato live
Dopo B3, mergiati su `main` via PR i **5 blocchi feature** del giro pre-lancio:
- **`block/pricing-copy`** (PR #8) — testi pricing 19€/3 · 39€/10 · 79€/30 su landing, `/pricing` e pricing in-app (via i vecchi 149€/49€).
- **`block/plan-upgrade`** (PR #10) — upgrade self-service al tier sopra (3→10→30, `stripe.subscriptions.update` con prorata; al top 30 → "contattaci"). `subscriptionId` salvato in account, endpoint upgrade, ladder tier server, frontend no-piano→checkout vs piano→upgrade.
- **`block/trial-banner-paid`** (PR #11) — un pagante non vede più il banner "🎁 Prova gratuita"; `stateView` espone `planActive`/`maxPublished`. Trial per i non-paganti: invariato.
- **`block/upgrade-route-fix`** (PR #12) — instrada `POST /api/projects/<id>/upgrade` (la rotta upgrade non era cablata).
- **`block/plan-panel`** (PR #13) — pannello piani tier-aware + **fix doppio-abbonamento** (no seconda subscription quando si è già paganti) + chip discreto.

**Upgrade validato LIVE** (test di Ale): paga → 3 siti → al 4° "Passa a 10 siti" → upgrade della subscription esistente, non checkout nuovo.

**Server allineato:** `/opt/brik` su `main` (`d624686`), pid 515457, **boot 2026-06-25 13:57:37 UTC** — cioè **51s dopo il merge #13** (13:56:46 UTC), quindi i 5 blocchi sono **tutti in memoria**. Banner pulito: `brik e attivo su http://localhost:4321` + `Pagamenti: Stripe attivo (19€/mese -> 3 siti, per-account)`. HTTP 200, servizio ininterrotto fino a oggi. `main` ↔ `origin/main` allineati.

## Ultimo blocco chiuso lato codice
**`block/plan-panel`** (PR #13) — pannello piani tier-aware, fix doppio-abbonamento, chip discreto. Vedi sezione "FATTO 2026-06-26".

## Storico precedente (2026-06-25)
**B3 — Billing Stripe per-account.** Stripe migrato da per-sito a per-account: price ricorrenti per tier → `maxPublished` (19€→3, 39€→10, 79€→30). Webhook `customer.subscription.*` alimenta il gate B2. Mergiati su `main`: `block/B3-stripe`, `block/checkout-cta` (modal PLAN_LIMIT_REACHED → "Attiva piano"), `block/gate-reviewer`. Spec: `docs/blocks/B3_stripe_billing.md`.

## ⚠️ APERTO ORA — verifiche operative residue (non-codice, pre/post lancio)
1. **Webhook Stripe doppio endpoint** (Dashboard, lo fa Ale): nei log di prima alcuni eventi davano `✗ No signatures found` con retry → probabile secondo endpoint sullo stesso URL con secret diverso (vecchio rimasto oltre a "charismatic-finesse"). Da fare: Dashboard → Webhooks, togliere il vecchio, altrimenti `subscription.updated/deleted` dall'endpoint sbagliato si perdono. **Nota:** il "fix doppio-abbonamento" di plan-panel (#13) è lato frontend (no doppia subscription dal client) — **non** risolve l'endpoint webhook duplicato, che resta da pulire sul Dashboard.
2. **e2e B3 ridotto via acquisto reale** — da confermare lo step `deleted`: dopo che Ale rimborsa+cancella da Dashboard, verificare che `data/accounts/<email>.json` torni a `maxPublished 0`. (Il ramo `created` → `maxPublished 3` è coperto dal flusso upgrade validato live.)
3. **Backup `.bak-b3` da rimuovere** (ancora presenti su disco): `src/server/accountStore.ts.bak-b3`, `src/server/server.ts.bak-b3`, `docs/VISION.md.bak-b3`. Cleanup dopo conferma definitiva e2e. (Vecchi `.bak-login-project-*`/`.bak-pizzerie-*`: a parte.)
4. **Account founder fuori scala**: `ale@atlantix.io` ha 33 siti pubblicati legacy → col piano da 3 il gate (`33<3=false`) blocca sempre. Non è un bug del billing. **FUORI dal lancio** (decisione Ale): testare il flusso con email nuova (0 pubblicati). Decisione operatore separata per l'account founder.

## Branch — stato
- **Mergiati su `main`** (`d624686`): B3 (`block/B3-stripe`, `block/checkout-cta`, `block/gate-reviewer`) + i 5 rifiniture (`block/pricing-copy`, `block/plan-upgrade`, `block/trial-banner-paid`, `block/upgrade-route-fix`, `block/plan-panel`). Server gira da `main`.
- **Stale/già mergiati** da cancellare su GitHub: i branch dei blocchi sopra + il vecchio `docs/state-sync` (PR #9, superato da questo sync).
- Regola invariata: un branch per blocco, gate REVIEWER prima del "fatto", **merge = Ale via PR**.

## Prossimo step
Chiudere le verifiche operative residue (webhook Dashboard, e2e `deleted`, cleanup `.bak-b3`) → **LANCIO**. Dopo il lancio: B10 (script analytics/pixel non iniettati), B11 (multilingua IT/EN), B12 (consent banner GDPR). Track M: marketplace design.

## Baseline (verificata su `main` HEAD `d624686`, 2026-06-26 — NON riportarsi dietro vecchi miti)
- `npm run typecheck` → **ZERO errori**.
- `npm test` → **suite completa via `test/*.test.ts`, 319/319 verde, 0 fail**. Lista fallimenti-noti **VUOTA**; cresce solo con OK esplicito di Ale.
- **`site.test #19` è VERDE** (`ok 19`). Il "debito storico" (`editProject … FA CRESCERE il contratto`) era già risolto. Nessuna sessione futura lo riporti come rosso noto — non lo è.

## Gate di processo (attivo)
Ogni blocco passa il subagent `reviewer` (`.claude/agents/reviewer.md`) a context fresco prima di essere "chiuso". PASS ⇔ typecheck ZERO **E** suite senza fallimenti nuovi **E** accettazione **E** invarianti **E** no scope creep. Un branch per blocco; doc allineati nello stesso branch; main solo via PR di Ale. SECURITY/ARCHITECT/DOCKEEPER: role file pronti in `docs/roles/`, non ancora cablati come subagent.
