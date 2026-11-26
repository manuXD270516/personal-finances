---
id: TC-FORECAST-ANOMALY-029
title: "Un gasto con varias porciones se evalúa por contraparte en la categoría de su porción mayor"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Gastos atípicos para su contraparte"
scenario: "Gasto con varias porciones"
requirement_status: provisional
fr: ["FR-FORECAST-010"]
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
tags: ["anomalies", "calibration", "counterparty", "splits"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y parámetros por omisión"
  - "Historia de \"Hipermaxi\" en \"Supermercado\" y en \"Artículos de limpieza\" con al menos 8 gastos cada una"
input: {}
steps:
  - "se evalúa un gasto de 500.00 BOB con \"Hipermaxi\" con una porción de 380.00 BOB en \"Supermercado\" y otra de 120.00 BOB en \"Artículos de limpieza\""
expected_result:
  - "el criterio de contraparte usa la historia de \"Hipermaxi\" en \"Supermercado\""
  - "un motivo COUNTERPARTY_OUTLIER, si lo hay, informa categoryId de \"Supermercado\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-029 — Un gasto con varias porciones se evalúa por contraparte en la categoría de su porción mayor

## Intención

Verifica el scenario "Gasto con varias porciones" del requirement "Gastos atípicos para su contraparte" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y parámetros por omisión
Y Historia de "Hipermaxi" en "Supermercado" y en "Artículos de limpieza" con al menos 8 gastos cada una
Cuando se evalúa un gasto de 500.00 BOB con "Hipermaxi" con una porción de 380.00 BOB en "Supermercado" y otra de 120.00 BOB en "Artículos de limpieza"
Entonces el criterio de contraparte usa la historia de "Hipermaxi" en "Supermercado"
Y un motivo COUNTERPARTY_OUTLIER, si lo hay, informa categoryId de "Supermercado"
```

## Notas

- Change `refine-spending-anomaly-calibration` (Phase 9), decisión 1 del design (categoría principal: porción de mayor monto; con empate, la primera). Datos ficticios; ningún dato real del owner.
