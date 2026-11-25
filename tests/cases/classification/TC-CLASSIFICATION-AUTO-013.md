---
id: TC-CLASSIFICATION-AUTO-013
title: "El formulario muestra la sugerencia al escribir la descripción sin asignarla"
spec: classification/auto-classification
related_specs: []
requirement: "Sugerencia en el alta manual"
scenario: "Sugerencia al escribir la descripción"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-014"]
nfr: ["NFR-SEC-009"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
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
  - "el historial es el de TC-CLASSIFICATION-AUTO-001"
  - "el EDITOR escribe \"PEDIDOSYA *8812\" en un gasto nuevo sin categoría"
expected_result:
  - "el formulario muestra \"Restaurantes\" con confianza alta y el motivo, sin asignarla"
  - "la petición de la sugerencia es un POST y la descripción no aparece en la URL"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-013 — El formulario muestra la sugerencia al escribir la descripción sin asignarla

## Intención

Verifica el scenario "Sugerencia al escribir la descripción" del requirement "Sugerencia en el alta manual" de `classification/auto-classification` (FR-CLASSIFICATION-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando el historial es el de TC-CLASSIFICATION-AUTO-001
Y el EDITOR escribe "PEDIDOSYA *8812" en un gasto nuevo sin categoría
Entonces el formulario muestra "Restaurantes" con confianza alta y el motivo, sin asignarla
Y la petición de la sugerencia es un POST y la descripción no aparece en la URL
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
