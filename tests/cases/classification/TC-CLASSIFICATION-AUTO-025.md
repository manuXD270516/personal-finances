---
id: TC-CLASSIFICATION-AUTO-025
title: "La sugerencia por historial reemplaza a la última categoría usada de la contraparte"
spec: classification/counterparties
related_specs: []
requirement: "Sugerencia de categoría por counterparty"
scenario: "La sugerencia por historial reemplaza a la última usada"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-011","FR-CLASSIFICATION-014"]
nfr: []
invariants: []
priority: medium
type: integration
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
  - "\"Farmacorp\" no tiene categoría por defecto, 4 de sus 5 gastos clasificados por el usuario están en \"Farmacia\" y el último está en \"Regalos\""
  - "el usuario elige \"Farmacorp\" en un gasto nuevo"
expected_result:
  - "se sugiere \"Farmacia\" con confianza 0.8000, no \"Regalos\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-025 — La sugerencia por historial reemplaza a la última categoría usada de la contraparte

## Intención

Verifica el scenario "La sugerencia por historial reemplaza a la última usada" del requirement "Sugerencia de categoría por counterparty" de `classification/counterparties` (FR-CLASSIFICATION-011, FR-CLASSIFICATION-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando "Farmacorp" no tiene categoría por defecto, 4 de sus 5 gastos clasificados por el usuario están en "Farmacia" y el último está en "Regalos"
Y el usuario elige "Farmacorp" en un gasto nuevo
Entonces se sugiere "Farmacia" con confianza 0.8000, no "Regalos"
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
