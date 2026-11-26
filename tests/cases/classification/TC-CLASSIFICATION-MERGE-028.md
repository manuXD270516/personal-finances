---
id: TC-CLASSIFICATION-MERGE-028
title: "La serie de pronóstico de la destino incluye los meses cerrados de la origen fusionada"
spec: classification/categories
related_specs: ["planning/month-closing"]
requirement: "Continuidad de la historia de una categoría fusionada en los análisis"
scenario: "Serie de pronóstico con meses cerrados de la origen"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007", "FR-FORECAST-001"]
nfr: []
invariants: []
priority: low
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["merge", "categories", "forecast", "closed-periods"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB con TZ America/La_Paz; periodos de mayo a octubre de 2026 cerrados y noviembre de 2026 abierto"
  - "\"Super\" con un gasto de 100.00 BOB en cada mes de mayo a octubre de 2026; \"Supermercado\" sin gastos en esos meses"
input: {}
steps:
  - "el EDITOR fusiona \"Super\" en \"Supermercado\" en noviembre de 2026"
  - "se prepara la siguiente corrida de pronóstico"
expected_result:
  - "la serie de \"Supermercado\" tiene 100.00 BOB en cada mes de mayo a octubre de 2026"
  - "el reporte de octubre de 2026 sigue mostrando \"Super\" = 100.00 BOB"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-028 — La serie de pronóstico de la destino incluye los meses cerrados de la origen fusionada

## Intención

Verifica el scenario "Serie de pronóstico con meses cerrados de la origen" del requirement "Continuidad de la historia de una categoría fusionada en los análisis" de `classification/categories` (FR-CLASSIFICATION-007, FR-FORECAST-001).

## Escenario

```gherkin
Dado Workspace "W1" en BOB con TZ America/La_Paz; periodos de mayo a octubre de 2026 cerrados y noviembre de 2026 abierto
Y "Super" con un gasto de 100.00 BOB en cada mes de mayo a octubre de 2026; "Supermercado" sin gastos en esos meses
Cuando el EDITOR fusiona "Super" en "Supermercado" en noviembre de 2026
Y se prepara la siguiente corrida de pronóstico
Entonces la serie de "Supermercado" tiene 100.00 BOB en cada mes de mayo a octubre de 2026
Y el reporte de octubre de 2026 sigue mostrando "Super" = 100.00 BOB
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9), D496, tarea 3.9 (`CategoryMergeQuery.resolve`). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
