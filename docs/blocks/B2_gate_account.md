# B2 — Gate account/siti pubblicati

**Stato:** in-progress
**Obiettivo:** un account pubblica fino a `maxPublished` siti (0 default, 3 col piano base). Oltre il limite, publish bloccato. Gate che B3/Stripe alimentera\u0300.

## Diagnosi (verificato sul codice)
- `entitled` = booleano per-sito, isolato (`siteTypes.ts:50`; letto in `siteSession.ts:1097/1273/1340/1317`).
- Nessun concetto di piano-account. Conteggio siti per email solo statistico (`server.ts:1138/1200`).
- Publish (`server.ts` ramo `action==='publish'`, ~2036) blocca solo sito incompleto (~2095), nessun gate di piano.
- Trial scatta per-sito alla prima pubblicazione (`siteSession.ts:1266`).

## Correzione (minimale)
1. Nuovo store account per-email con campo `accountPlan: { maxPublished: number }`, default 0.
2. Gate al publish: contati i siti `published` dell'owner; se `>= maxPublished` E sito non `entitled` -> blocca `PLAN_LIMIT_REACHED`.
3. `entitled` invariato: override per-sito, bypassa il gate.
4. Endpoint operatore per settare `maxPublished` (lo scrivera\u0300 Stripe in B3).

## File
- store account per-email (nuovo, in `src/server/` o `data/accounts/`)
- `src/server/server.ts` — gate al publish + endpoint set-plan operatore
- `src/project/siteTypes.ts` — tipo se serve

## Vincoli (INVARIANTS)
Nessun placeholder pubblicato; home intatta; nessun ciclo LLM extra; il gate e\u0300 puro controllo, non rigenera.

## Criterio di accettazione
- account maxPublished=3 con 3 siti pubblicati -> 4\u00b0 publish riceve `PLAN_LIMIT_REACHED`
- sito `entitled` -> pubblica comunque
- sotto il limite -> publish invariato
- account nuovo (maxPublished=0) -> non pubblica nulla

## Test
unit sul gate: 3+1 bloccato, entitled bypassa, sotto limite ok. Baseline invariata (3 tsc err, site.test #19).
