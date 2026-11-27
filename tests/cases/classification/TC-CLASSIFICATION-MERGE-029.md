---
id: TC-CLASSIFICATION-MERGE-029
title: "La detección de gastos atípicos evalúa con la historia de la origen fusionada"
spec: classification/categories
related_specs: ["forecast/anomaly-detection"]
requirement: "Continuidad de la historia de una categoría fusionada en los análisis"
scenario: "Gasto atípico con la historia de la origen"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-007", "FR-FORECAST-010"]
nfr: []
invariants: []
priority: low
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/application/category-merge.test.ts
status: automated
regression_suite: true
phase: 9
tags: ["merge", "categories", "anomalies"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; \"Super\" con 12 gastos de entre 70.00 y 90.00 BOB en periodos cerrados; \"Supermercado\" sin gastos anteriores"
  - "Un gasto atípico marcado antes de la fusión"
input: {}
steps:
  - "el EDITOR fusiona \"Super\" en \"Supermercado\""
  - "se registra un gasto de 400.00 BOB en \"Supermercado\" y corre la pasada de detección"
expected_result:
  - "el gasto se evalúa con una historia de 12 gastos de \"Supermercado\""
  - "el gasto atípico marcado antes de la fusión no cambia"
created: 2026-11-25
updated: 2026-11-27
---

# TC-CLASSIFICATION-MERGE-029 — La detección de gastos atípicos evalúa con la historia de la origen fusionada

## Intención

Verifica el scenario "Gasto atípico con la historia de la origen" del requirement "Continuidad de la historia de una categoría fusionada en los análisis" de `classification/categories` (FR-CLASSIFICATION-007, FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; "Super" con 12 gastos de entre 70.00 y 90.00 BOB en periodos cerrados; "Supermercado" sin gastos anteriores
Y Un gasto atípico marcado antes de la fusión
Cuando el EDITOR fusiona "Super" en "Supermercado"
Y se registra un gasto de 400.00 BOB en "Supermercado" y corre la pasada de detección
Entonces el gasto se evalúa con una historia de 12 gastos de "Supermercado"
Y el gasto atípico marcado antes de la fusión no cambia
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9), D496, tarea 3.9. Datos ficticios; ningún dato real del owner.
