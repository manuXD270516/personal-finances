---
id: TC-FORECAST-ANOMALY-028
title: "Una contraparte sin historia en la categoría del gasto no se evalúa por contraparte ni como nueva"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Gastos atípicos para su contraparte"
scenario: "Contraparte con gastos de otra categoría"
requirement_status: confirmed
fr: ["FR-FORECAST-010"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/domain/spending-anomaly-detector.test.ts
  - packages/contexts/forecasting/src/domain/expense-history-index.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["anomalies", "calibration", "counterparty"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y parámetros por omisión"
  - "\"Hipermaxi\" con 20 gastos en \"Supermercado\" en los 365 días anteriores (mediana 150.00 BOB) y ninguno en \"Electrónica\""
input: {}
steps:
  - "se evalúa un gasto de 900.00 BOB en \"Electrónica\" con \"Hipermaxi\""
expected_result:
  - "no hay motivo COUNTERPARTY_OUTLIER"
  - "no hay motivo NEW_COUNTERPARTY_HIGH_AMOUNT"
created: 2026-11-25
updated: 2026-11-26
---

# TC-FORECAST-ANOMALY-028 — Una contraparte sin historia en la categoría del gasto no se evalúa por contraparte ni como nueva

## Intención

Verifica el scenario "Contraparte con gastos de otra categoría" del requirement "Gastos atípicos para su contraparte" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y parámetros por omisión
Y "Hipermaxi" con 20 gastos en "Supermercado" en los 365 días anteriores (mediana 150.00 BOB) y ninguno en "Electrónica"
Cuando se evalúa un gasto de 900.00 BOB en "Electrónica" con "Hipermaxi"
Entonces no hay motivo COUNTERPARTY_OUTLIER
Y no hay motivo NEW_COUNTERPARTY_HIGH_AMOUNT
```

## Notas

- Change `refine-spending-anomaly-calibration` (Phase 9), decisión 1 del design. Datos ficticios; ningún dato real del owner.
