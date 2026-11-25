---
id: TC-CLASSIFICATION-AUTO-018
title: "El informe calcula la tasa de aceptación del mes"
spec: classification/auto-classification
related_specs: []
requirement: "Tasa de aceptación de las sugerencias"
scenario: "Tasa del mes"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-014"]
nfr: []
invariants: ["INV-020"]
priority: medium
type: api
level: api
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
  - "en noviembre de 2026 se registraron 15 resultados ACCEPTED, 3 CORRECTED y 2 IGNORED"
  - "se pide GET /category-suggestions/stats de 2026-11-01 a 2026-11-30"
expected_result:
  - "la respuesta indica 20 mostradas, 15 aceptadas, 3 corregidas, 2 ignoradas y acceptanceRate 0.7500"
  - "la tabla rules.category_suggestion_outcome no guarda descripciones, montos ni categorías"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-018 — El informe calcula la tasa de aceptación del mes

## Intención

Verifica el scenario "Tasa del mes" del requirement "Tasa de aceptación de las sugerencias" de `classification/auto-classification` (FR-CLASSIFICATION-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando en noviembre de 2026 se registraron 15 resultados ACCEPTED, 3 CORRECTED y 2 IGNORED
Y se pide GET /category-suggestions/stats de 2026-11-01 a 2026-11-30
Entonces la respuesta indica 20 mostradas, 15 aceptadas, 3 corregidas, 2 ignoradas y acceptanceRate 0.7500
Y la tabla rules.category_suggestion_outcome no guarda descripciones, montos ni categorías
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
