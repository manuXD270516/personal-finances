---
id: TC-CLASSIFICATION-AUTO-012
title: "Aceptar la sugerencia en el formulario deja la categoría con origen manual"
spec: classification/auto-classification
related_specs: []
requirement: "Ninguna sugerencia se aplica sin confirmación"
scenario: "Aceptar en el formulario"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-014"]
nfr: []
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/application/category-suggestions.test.ts
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
  - "el formulario muestra la sugerencia \"Restaurantes\""
  - "el usuario la acepta y guarda el gasto"
expected_result:
  - "el gasto queda en \"Restaurantes\" con origen manual"
  - "se registra un resultado ACCEPTED con canal MANUAL_ENTRY"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-012 — Aceptar la sugerencia en el formulario deja la categoría con origen manual

## Intención

Verifica el scenario "Aceptar en el formulario" del requirement "Ninguna sugerencia se aplica sin confirmación" de `classification/auto-classification` (FR-CLASSIFICATION-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando el formulario muestra la sugerencia "Restaurantes"
Y el usuario la acepta y guarda el gasto
Entonces el gasto queda en "Restaurantes" con origen manual
Y se registra un resultado ACCEPTED con canal MANUAL_ENTRY
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
