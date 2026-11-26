---
id: TC-CLASSIFICATION-AUTO-014
title: "Aceptar en lote las sugerencias de confianza alta"
spec: classification/auto-classification
related_specs: []
requirement: "Sugerencia en la vista previa del import"
scenario: "Aceptar las sugerencias de confianza alta"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-014","FR-IMPORTS-009"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/testing/import-pipeline.suggestions.test.ts
  - apps/web/src/ui/category-suggestions/category-suggestions.test.tsx
  - apps/api/test/api/category-suggestions.api.test.ts
  - tests/e2e/specs/category-suggestions.spec.ts
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
  - "de 40 filas sin categoría después de las reglas, 25 tienen sugerencia HIGH, 10 MEDIUM y 5 ninguna"
  - "el EDITOR llama a accept-suggestions con minLevel HIGH y la versión vigente"
expected_result:
  - "la respuesta indica accepted 25 y una versión nueva"
  - "las 25 filas quedan con la categoría sugerida y origen manual y las otras 15 no cambian"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-014 — Aceptar en lote las sugerencias de confianza alta

## Intención

Verifica el scenario "Aceptar las sugerencias de confianza alta" del requirement "Sugerencia en la vista previa del import" de `classification/auto-classification` (FR-CLASSIFICATION-014, FR-IMPORTS-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando de 40 filas sin categoría después de las reglas, 25 tienen sugerencia HIGH, 10 MEDIUM y 5 ninguna
Y el EDITOR llama a accept-suggestions con minLevel HIGH y la versión vigente
Entonces la respuesta indica accepted 25 y una versión nueva
Y las 25 filas quedan con la categoría sugerida y origen manual y las otras 15 no cambian
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
