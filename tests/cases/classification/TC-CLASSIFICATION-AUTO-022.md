---
id: TC-CLASSIFICATION-AUTO-022
title: "Con la función deshabilitada no hay sugerencias"
spec: classification/auto-classification
related_specs: []
requirement: "Sugerencias sin el servicio de pronósticos ni procesos nuevos"
scenario: "Función deshabilitada"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-014"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/application/category-suggestions.test.ts
  - packages/contexts/imports/src/testing/import-pipeline.suggestions.test.ts
  - apps/api/test/api/category-suggestions-disabled.api.test.ts
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
  - "RULES_CATEGORY_SUGGEST_ENABLED=false"
  - "se pide una sugerencia y se procesa una importación"
expected_result:
  - "la consulta responde DISABLED"
  - "ninguna fila de la vista previa tiene suggestedCategory"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-022 — Con la función deshabilitada no hay sugerencias

## Intención

Verifica el scenario "Función deshabilitada" del requirement "Sugerencias sin el servicio de pronósticos ni procesos nuevos" de `classification/auto-classification` (FR-CLASSIFICATION-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando RULES_CATEGORY_SUGGEST_ENABLED=false
Y se pide una sugerencia y se procesa una importación
Entonces la consulta responde DISABLED
Y ninguna fila de la vista previa tiene suggestedCategory
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
