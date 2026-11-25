---
id: TC-CLASSIFICATION-AUTO-002
title: "Siete de diez sugiere con confianza media"
spec: classification/auto-classification
related_specs: []
requirement: "Sugerencia de categoría por historial"
scenario: "Siete de diez"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-014"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
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
  - "el patrón tiene 10 gastos, 7 en \"Restaurantes\" y 3 en \"Supermercado\""
expected_result:
  - "se sugiere \"Restaurantes\" con confianza 0.7000 y nivel MEDIUM"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-002 — Siete de diez sugiere con confianza media

## Intención

Verifica el scenario "Siete de diez" del requirement "Sugerencia de categoría por historial" de `classification/auto-classification` (FR-CLASSIFICATION-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando el patrón tiene 10 gastos, 7 en "Restaurantes" y 3 en "Supermercado"
Entonces se sugiere "Restaurantes" con confianza 0.7000 y nivel MEDIUM
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
