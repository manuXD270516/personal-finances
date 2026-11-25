---
id: TC-CLASSIFICATION-AUTO-019
title: "El backtesting informa precisión y cobertura por mes y en total"
spec: classification/auto-classification
related_specs: []
requirement: "Backtesting temporal de las sugerencias"
scenario: "Tres meses sobre el umbral"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-014"]
nfr: []
invariants: ["INV-020"]
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["category-suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; historial clasificado por el usuario (origen manual) salvo que el escenario diga otro"
input: {}
steps:
  - "el backtesting de julio a septiembre de 2026 hace 300 sugerencias sobre 400 transacciones y acierta 264"
expected_result:
  - "informa precisión 0.8800 y cobertura 0.7500"
  - "la fila del nightly pasa (umbral 0.8500)"
  - "el informe no contiene descripciones ni montos"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-019 — El backtesting informa precisión y cobertura por mes y en total

## Intención

Verifica el scenario "Tres meses sobre el umbral" del requirement "Backtesting temporal de las sugerencias" de `classification/auto-classification` (FR-CLASSIFICATION-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando el backtesting de julio a septiembre de 2026 hace 300 sugerencias sobre 400 transacciones y acierta 264
Entonces informa precisión 0.8800 y cobertura 0.7500
Y la fila del nightly pasa (umbral 0.8500)
Y el informe no contiene descripciones ni montos
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
- Con el Large Seed real lo mide el nightly (`pnpm rules:category-suggestions:backtest`).
