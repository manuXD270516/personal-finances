---
id: TC-CLASSIFICATION-AUTO-016
title: "Si falla el cálculo de sugerencias el import se puede aprobar igual"
spec: classification/auto-classification
related_specs: []
requirement: "Sugerencia en la vista previa del import"
scenario: "Sugerencias no disponibles"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-014","FR-IMPORTS-009"]
nfr: []
invariants: []
priority: medium
type: integration
level: import
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/testing/import-pipeline.suggestions.test.ts
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
  - "el cálculo de sugerencias falla al procesar una importación"
expected_result:
  - "las filas quedan sin sugerencia"
  - "la importación llega a \"en revisión\" y se puede aprobar"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-016 — Si falla el cálculo de sugerencias el import se puede aprobar igual

## Intención

Verifica el scenario "Sugerencias no disponibles" del requirement "Sugerencia en la vista previa del import" de `classification/auto-classification` (FR-CLASSIFICATION-014, FR-IMPORTS-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando el cálculo de sugerencias falla al procesar una importación
Entonces las filas quedan sin sugerencia
Y la importación llega a "en revisión" y se puede aprobar
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
