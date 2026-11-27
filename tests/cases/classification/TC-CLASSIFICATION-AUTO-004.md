---
id: TC-CLASSIFICATION-AUTO-004
title: "Un empate o una sola transacción no sugieren"
spec: classification/auto-classification
related_specs: []
requirement: "Sugerencia de categoría por historial"
scenario: "Empate o una sola transacción"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-014"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/domain/category-suggester.test.ts
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
  - "un patrón tiene 2 gastos en \"Taxi\" y 2 en \"Viajes\" y otro patrón tiene un solo gasto"
expected_result:
  - "no se sugiere ninguna categoría para ninguno de los dos"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-004 — Un empate o una sola transacción no sugieren

## Intención

Verifica el scenario "Empate o una sola transacción" del requirement "Sugerencia de categoría por historial" de `classification/auto-classification` (FR-CLASSIFICATION-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando un patrón tiene 2 gastos en "Taxi" y 2 en "Viajes" y otro patrón tiene un solo gasto
Entonces no se sugiere ninguna categoría para ninguno de los dos
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
