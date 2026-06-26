# block/style-catalog-preview-cards — Catalogo stili: Style Preview Cards

**Tipo:** solo UI (catalogo selezione stile in Studio). Nessun tocco a generazione/mapping theme/API/prompt/publish/dati.

## Problema
Il catalogo stili (`askStyle`, `web/app.js`) renderizzava ogni miniatura con un `<iframe>` su `/style-samples/<id>.html` scalato → testi che escono, scrollbar interne, crop a caso, label illeggibili.

## Soluzione
"Style Preview Cards": moodboard CSS per-tema, niente iframe/screenshot/immagini esterne.
- **Data map** `STYLE_PREVIEW_META` (`web/app.js`) keyed by theme id (invariato): `{ title (1 parola), name, mood, previewKind }` per i 9 temi.
- **Renderer**: `stylePreviewInnerHTML(meta)` + costruzione card in `askStyle` (button `.styleCard` con `data-theme-id`, `data-selected`, `aria-pressed`, `aria-label`; `.stylePreview.preview-<kind>` con header titolo+dot e body con 3 blocchi `.pv`; `.styleFooter` con `.styleName` + `.styleMood`). Preview "consigliata" in alto = `.stylePreview--lead`.
- **CSS dedicato** (`web/style.css`): `.catalogGrid` (2 col, minmax(128px,1fr), gap 12px), `.styleCard` (selected = bordo `#7C6BFF` + glow), `.stylePreview` (aspect 4/5, overflow hidden, isolation), footer leggibile con ellipsis, + 9 varianti `.preview-*` (palette/typography/decori per mood).
- **Rimossi** (orfani dopo il fix): `scaleStyleFrames`, `STYLE_DESIGN_W/H`, CSS `.style-grid/.style-card/.sp-frame/.sp-if`. I file `/style-samples/*.html` restano su disco (non più referenziati dal catalogo).

## Compatibilità (invariata)
`STYLES[].id` e il valore passato a `onPick(chosen)` → `createSite(..., theme, ...)` sono identici a prima. Cambia solo la presentazione del catalogo.

## Criterio di accettazione (verificato)
1. Niente testi tagliati male (titoli 1 parola in preview; nome/mood nel footer con ellipsis). 2. Nessuna scrollbar interna (`overflow:hidden` su card/preview; verificato `scrollWidth<=clientWidth` salvo residuo di misura di un pseudo, clippato). 3. Nome e mood leggibili (testo chiaro su card scura). 4. Preview parte dello stesso sistema visivo. 5. Ogni preview comunica il mood (direzione visiva per ognuna). 6. Selected evidente (bordo accent + glow). 7. Usabile in sidebar stretta (reso a ~360px, 2 col). 8. Logica generazione/publish non modificata. 9. Nessuna immagine esterna obbligatoria (CSS puro). 10. Codice semplice: una mappa, un renderer, CSS dedicato.

## Vincoli
- a11y: card = `<button>`, `aria-pressed` su selected, `aria-label` "Seleziona <name>, <mood>", `:focus-visible`.
- Nessuna nuova dipendenza. `web/app.js` è JS → verifica `node --check` + screenshot Playwright.
