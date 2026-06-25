# B3 — Billing Stripe per-account

**Stato:** review (gate REVIEWER PASS 2026-06-24; e2e Stripe test-mode ancora da fare)
**Obiettivo:** l'abbonamento si paga per-account, non per-sito. Un price ricorrente mensile per tier accende `maxPublished` dell'account (lo slot di pubblicazione di B2): 19€→3, 39€→10, 79€→30. Il gate B2 resta il punto di enforcement; B3 lo alimenta da Stripe.

## Diagnosi (verificato sul codice)
- Prima di B3 Stripe era **per-sito**: il checkout dava un entitlement al singolo `siteId` (`grantEntitlement`), con `trial_period_days: 365` lato Stripe e price LANCIO/annuale (`STRIPE_PRICE_LAUNCH`/`STRIPE_PRICE_YEARLY`).
- Il gate account di B2 (`canPublish`, `maxPublished` per-email in `accountStore.ts`) non aveva nessuna sorgente automatica: `maxPublished` lo settava solo l'operatore via `/api/admin/plan`.
- Mancava il ponte Stripe→account: nessun webhook traduceva lo stato della subscription nello slot dell'account.

## Correzione (minimale)
1. Funzione pura `maxPublishedForSubscription(eventType, status, priceId, priceToMax)` in `accountStore.ts`: traduce lo stato subscription in `maxPublished`. `past_due` mantiene il piano (grace); `customer.subscription.deleted` e `canceled/unpaid/incomplete_expired/incomplete` → 0; altrimenti `priceToMax[priceId] ?? 0`.
2. `server.ts`: env `STRIPE_PRICE_BASE/PLUS/PRO` + mappa `PRICE_TO_MAX` (3/10/30) che accende solo i tier con env valorizzata. `STRIPE_READY` richiede `stripe` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_BASE`.
3. Webhook `/api/stripe/webhook`: su `customer.subscription.created/updated/deleted` legge `email` da `sub.metadata.email` e `priceId` da `sub.items.data[0].price.id`, poi `setAccountMaxPublished(email, maxPublishedForSubscription(...))`. `checkout.session.completed` resta **solo** per Meta CAPI `Purchase` (niente entitlement per-sito).
4. Checkout (`action checkout`): `mode: 'subscription'`, 1 line_item `STRIPE_PRICE_BASE`, `subscription_data.metadata.email = ownerEmail`, **nessun trial Stripe** (il trial è `maxPublished=0` di default lato brik). Guard `NO_ACCOUNT_EMAIL` se manca l'email.

## File
- `src/server/accountStore.ts` — funzione pura `maxPublishedForSubscription` (`:62-74`)
- `src/server/server.ts` — env + `PRICE_TO_MAX` (`:157-166`); webhook subscription (`:1528-1547`); checkout per-account (`:1832-1852`)
- `test/stripeWebhook.test.ts` — 9 unit sulla funzione pura (nuovo)
- `docs/ROADMAP.md`, `docs/VISION.md` — stato B3 e modello di prezzo per-account

## Vincoli (INVARIANTS)
Nessun invariante di prodotto coinvolto: B3 tocca solo il billing. La logica è puro controllo di stato (nessun ciclo LLM, nessun placeholder, home intatta). Il gate scatta a publish-time (B2): alla disdetta i siti già pubblicati restano online, non se ne pubblicano di nuovi.

## Criterio di accettazione
- subscription `active` su price BASE → `maxPublished=3` sull'account (PLUS→10, PRO→30).
- `past_due` → il piano resta (grace), non azzera.
- `canceled/unpaid/incomplete_expired/incomplete` o `subscription.deleted` → `maxPublished=0`.
- price sconosciuto → 0.
- checkout reale → crea subscription con `metadata.email` corretta; nessun trial Stripe.
- **e2e (Fase 3, ancora da fare):** checkout in test-mode scrive `data/accounts/<email>.json` con `maxPublished=3`; il 4° publish dà `PLAN_LIMIT_REACHED`.

## Test
9 unit in `test/stripeWebhook.test.ts` sulla funzione pura (tutti gli stati sopra). Suite completa 312/312 verde, typecheck ZERO. Gate REVIEWER: PASS (smoke test 2026-06-24). Manca solo l'e2e test-mode.
