# STATE — dove siamo adesso

> Doc di processo, leggibile in 30 secondi a inizio sessione. Aggiornalo a ogni step come la ROADMAP. Ultimo aggiornamento: **2026-06-24**.

## Critical path al ricavo
B1 ✓ → B2 ✓ (live) → **B3 ✓ lato codice** (gate REVIEWER PASS) → **LANCIO**.

## Ultimo blocco chiuso lato codice
**B3 — Billing Stripe per-account.** Stripe migrato da per-sito a per-account: price ricorrenti per tier → `maxPublished` (19€→3, 39€→10, 79€→30). Webhook `customer.subscription.*` alimenta il gate B2. Suite 312/312 verde, typecheck ZERO, gate REVIEWER PASS. Spec: `docs/blocks/B3_stripe_billing.md`.

## Decisione di scope e2e B3 (2026-06-24)
- **e2e RIDOTTO sul solo ponte Stripe.** Si verifica: `stripe trigger customer.subscription.created` → `data/accounts/<email>.json` = `maxPublished 3`; `trigger ...deleted` → torna `0`. Il **gate del 4° publish NON si rifà e2e**: già coperto dagli unit B2 (3 build Playwright reali sarebbero costose e ridondanti).
- **Prerequisito: micro-blocco `block/data-dir-env`** — `DATA_DIR` configurabile via env con fallback al path attuale, così lo staging isola i dati senza worktree-hack e ogni test futuro è pulito. Passa dal gate REVIEWER prima di essere chiuso.

## APERTO ORA (cosa manca prima del lancio)
1. **`block/data-dir-env`** (prerequisito e2e): `DATA_DIR ?? path attuale` in `accountStore.ts` + `server.ts`. → da implementare, poi gate REVIEWER.
2. **e2e Stripe test-mode RIDOTTO** (Fase 3): ambiente STAGING isolato — **NON si testa su `/opt/brik`** (chiavi `.env` prod = **LIVE**, zero trigger/checkout lì). Serve: Stripe CLI (⬅ installazione OK da Ale, in corso), chiavi `sk_test_`, 3 price ricreati in test-mode (li crea Ale da Dashboard), `.env.staging` con `DATA_DIR` isolata + `PORT=4322`/`APP_URL`. Processo a mano (non systemd) + `stripe listen --forward-to localhost:4322/api/stripe/webhook`.
2. **Backup `.bak-b3` da rimuovere** dopo conferma e2e: `src/server/accountStore.ts.bak-b3`, `src/server/server.ts.bak-b3`, `docs/VISION.md.bak-b3`. (Residui vecchi `.bak-login-project-*` e `.bak-pizzerie-*`: valutarli a parte, non in questo giro.)
3. **Due PR aperte da mergiare** (vedi sotto).

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
