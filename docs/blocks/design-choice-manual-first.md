# block/design-choice-manual-first — Scelta design: manuale primaria, auto come scorciatoia

**Tipo:** solo UI dello step "Stile" (`askStyle`). Nessun tocco a generazione/mapping theme/API/prompt/publish/dati.
**Dipendenza:** richiede `block/style-catalog-preview-cards` (le Style Preview Cards). Base = quel branch; **merge dopo** B-SC.

## Problema
Lo step stile fingeva di "indovinare": preview grande del tema consigliato + CTA primario "Crea con questo stile" (auto), catalogo manuale nascosto dietro un link grigio "Non fa per me — scegli dal catalogo". E `smartDefaultTheme` cade spesso su `scandinavian-service` → sembra proporre sempre lo stesso. La scelta manuale è in realtà il percorso che il cliente vuole.

## Soluzione (solo UI in `web/app.js` `askStyle` + micro-CSS)
- **Catalogo visibile di default** (`.catalogGrid` senza `display:none`): selezione manuale = gesto primario.
- **Rimossa** la grande preview "consigliata" (`stylePreview--lead`) e il toggle "Non fa per me".
- **Nessuna preselezione** (`chosen = null`): il tema consigliato resta solo come **badge "consigliato"** (`.styleRecBadge`) su una card.
- **Primario** `Crea con questo stile` (`.btn.accent`): nascosto finché l'utente non seleziona una card, poi appare e crea con la selezione.
- **Scorciatoia secondaria in fondo** `✨ Scegli per me` (`.btn.ghost`): procede col tema consigliato (`rec`) — scelta **assistita, NON casuale** — in 1 click (velocità preservata).
- **Copy onesta**: hint → "Scegli lo stile del sito: nove direzioni diverse. Oppure lascia scegliere a noi."

## Compatibilità (invariata)
`proceed(theme)` → `askVisualOptions(theme, opts => onPick(theme, opts))` → `createSite(..., theme, ...)`. Il theme id passato a valle è invariato (selezione manuale o `rec`); `rec` deriva da `recommendedStyle`/`smartDefaultTheme` come prima. Nessun cambio di flusso/endpoint/generazione/publish.

## Criterio di accettazione (verificato via screenshot, 2 stati)
1. Catalogo visibile da subito, manuale come percorso evidente. 2. Niente preview grande "consigliata". 3. Tema consigliato visibile solo come badge non invasivo. 4. Primario "Crea con questo stile" appare alla selezione; selected evidente. 5. "✨ Scegli per me" in fondo, secondario, procede col consigliato in 1 click. 6. Copy senza finto-indovino. 7. a11y preservata (button, aria-pressed, aria-label con "(consigliato)"). 8. Nessun cambio a generazione/publish/theme id.

## Vincoli
- Solo UI; nessuna nuova dipendenza. `web/app.js` è JS → `node --check` + screenshot Playwright.
