# Builder — Fase 0 (walking skeleton)

Scheletro end-to-end del prodotto. Porta uno **Spec confermato** fino a un sito
**pubblicato**, con adapter **mock** così gira in locale senza account esterni.
Gli adapter reali (Anthropic, sandbox, DB, hosting) implementano le stesse
interfacce e si sostituiscono uno a uno, **senza toccare l'orchestratore**.

## Come si esegue
```bash
npm install
npm start        # esegue la pipeline su uno spec di esempio (mock)
npm run typecheck
```
Output atteso: la pipeline passa per GENERATE → BUILD → DEPLOY e stampa un URL
pubblicato (finto).

## Architettura: Ports & Adapters (hexagonal)
Il cuore non conosce le tecnologie concrete. Conosce solo **porte** (interfacce).

```
src/
  core/          # dominio + PORTE (interfacce). Nessuna dipendenza esterna.
    domain.ts    #   ProjectSpec, AcceptanceCriterion, GeneratedProject, ...
    ports.ts     #   LLMProvider, CodeGenerator, BuildEngine, HostingProvider, ProjectStore
    result.ts    #   Result<T,E> + AppError (errori tipizzati)
    events.ts    #   eventi di pipeline (progresso/telemetria)
  orchestrator/  # la pipeline a stati + util (retry, timeout, logger)
    pipeline.ts  #   GENERATE → BUILD → [QA/approvazione/scan futuri] → DEPLOY
    states.ts    #   stati attivi (Fase 0) + futuri (dichiarati)
  adapters/      # implementazioni delle porte
    mock/        #   finte, per girare senza cloud (attive ora)
    anthropic/   #   LLM reale (pronto, da testare con la tua chiave)
  cli/           # entry: collega gli adapter e lancia un progetto
```

Le cartelle corrispondono ai **futuri package** di un monorepo: quando servirà,
si dividono in workspace senza rilavorare gli import (già fatti via alias
`@core` / `@orchestrator` / `@adapters`).

## Perché è facile espandere (richiesto)
- **Nuova tecnologia** (cambio LLM, sandbox, hosting) → nuovo adapter che
  implementa la porta esistente. L'orchestratore non cambia.
- **Nuova capacità post-MVP** (QA, brand-kit, integrazioni, sicurezza) → nuova
  porta + nuovo stato nella pipeline, inseriti tra quelli esistenti. I tipi di
  dominio hanno già i campi futuri come opzionali (brandKit, designReferences,
  locales) per non rompere nulla.
- **Stati futuri già dichiarati** in `states.ts` e punto d'innesto già marcato
  in `pipeline.ts` (tra BUILD e DEPLOY): la roadmap è visibile nel codice.
- **Errori tipizzati** (`Result`/`AppError`) e **retry/timeout** dal primo
  giorno: la forma giusta per la resilienza che si indurisce in Fase 6.

## Mappa con la roadmap
- **Fase 0 (questo)**: pipe end-to-end con mock + adapter Anthropic pronto.
- **Fase 1**: intake → criteri → test Livello 2; sostituire `mockCodeGenerator`
  con il generatore reale (usa `LLMProvider`) e aggiungere la porta `QaRunner`.
- **Fase 2-3**: stati VISUAL_APPROVAL / QA_* nella pipeline.
- **Fase 5**: stato SECURITY_SCAN prima di DEPLOY.

## Stato degli adapter
| Porta            | Mock (ora) | Reale                         |
|------------------|:----------:|-------------------------------|
| LLMProvider      | ✅         | ✅ Anthropic (da testare con chiave) |
| CodeGenerator    | ✅         | Fase 1                        |
| BuildEngine      | ✅         | Fase 1 (E2B/sandbox)          |
| HostingProvider  | ✅         | Fase 1 (Cloudflare/Vercel)    |
| ProjectStore     | ✅ memoria | Fase 1 (Supabase)             |

## Divisione del lavoro
**Fatto in autonomia (verificato in locale):** scaffold, core, orchestratore,
mock, adapter Anthropic, typecheck stretto, run end-to-end.

**Serve da te (Fase 1+):** repo GitHub dove ospitarlo; `ANTHROPIC_API_KEY` per
testare il codegen reale; poi account/chiavi di sandbox, Supabase, hosting e un
dominio per i sottodomini. In questo ambiente non raggiungo i tuoi account
cloud: scrivo e verifico in locale, l'esecuzione reale gira sulla tua infra.

---

# Fase 1 — Intake → criteri osservabili → verifica Livello 2

Il pezzo più rischioso del progetto, ora implementato e **verificato eseguendo
i test per davvero** (motore jsdom, perché in questa sandbox il browser di
Playwright non è scaricabile; in produzione gira Playwright sugli spec generati).

## Idea chiave (perché il Livello 2 è affidabile)
Non si fa scrivere all'LLM il codice dei test (fragile). Invece:
1. l'**intake classifica** la frase dell'utente in un **criterio tipizzato**
   (`CheckSpec`: content-present, form-submission, responsive, navigation,
   route-loads) — compito affidabile per un LLM;
2. la **generazione del test è deterministica** da template verificati;
3. ciò che non è classificabile viene **segnalato**, non finto-verificato.

Poiché i criteri sono tipizzati, lo **stesso criterio** è eseguibile da motori
diversi: Playwright (prod) o jsdom (CI/locale). Le porte `IntakeClassifier` e
`QaRunner` rendono entrambi sostituibili.

## File aggiunti
```
src/core/criteria.ts      # CheckSpec: criteri tipizzati e verificabili
src/core/qa.ts            # QaReport + porte IntakeClassifier, QaRunner
src/intake/               # motore intake + classificatore mock + reale (Anthropic)
src/qa/level2.ts          # criterio → spec Playwright (deterministico, prod)
src/qa/jsdomRunner.ts     # esecuzione criteri via jsdom (motore leggero)
src/qa/jsdomQaRunner.ts   # porta QaRunner (L1 + L2 + gate)
src/qa/gate.ts            # gate composito "build riuscita"
src/eval/harness.ts       # KPI: first-pass success rate (eval/regression)
```

## Come si esegue
```bash
npm run demo:phase1   # intake → criteri → QA → gate → eval (end-to-end)
npm run demo:qa       # criteri eseguiti su app corretta (PASS) e rotta (FAIL)
npm run demo:gen      # stampa lo spec Playwright generato dai criteri
```

Output atteso di `demo:phase1`: 3 criteri tipizzati + 1 segnalato; QA tutta
PASS sull'app corretta (build riuscita = true); eval con first-pass rate 50%
(la versione rotta fallisce, come deve).

## Esito della validazione del rischio n.1
I criteri **passano** sull'app corretta e **falliscono esattamente sui criteri
violati** quando l'app è rotta → il ponte intento→verifica funziona ed è
eseguito, non solo descritto. GO per proseguire.
