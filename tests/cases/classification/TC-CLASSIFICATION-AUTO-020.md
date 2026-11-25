---
id: TC-CLASSIFICATION-AUTO-020
title: "El backtesting exige al menos 3 meses"
spec: classification/auto-classification
related_specs: []
requirement: "Backtesting temporal de las sugerencias"
scenario: "Menos de 3 meses"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-014"]
nfr: []
invariants: []
priority: medium
type: unit
level: application
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/domain/category-suggester.test.ts
  - packages/contexts/rules/src/application/category-suggestions.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["category-suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; historial clasificado por el usuario (origen manual) salvo que el escenario diga otro"
input: {}
steps:
  - "se pide el backtesting con --months 2"
expected_result:
  - "se rechaza indicando que hacen falta al menos 3 meses y no se calcula nada"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-020 — El backtesting exige al menos 3 meses

## Intención

Verifica el scenario "Menos de 3 meses" del requirement "Backtesting temporal de las sugerencias" de `classification/auto-classification` (FR-CLASSIFICATION-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando se pide el backtesting con --months 2
Entonces se rechaza indicando que hacen falta al menos 3 meses y no se calcula nada
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
