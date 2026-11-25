---
id: TC-FORECAST-ANOMALY-001
title: "Un gasto de 3,8 veces la mediana de su categoría se marca como atípico"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Gastos atípicos para su categoría"
scenario: "Cena muy por encima de lo habitual"
requirement_status: confirmed
fr: ["FR-FORECAST-010"]
nfr: ["NFR-DATA-001","NFR-DATA-002"]
invariants: ["INV-001","INV-020"]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/application/spending-anomalies.test.ts
  - packages/contexts/forecasting/src/domain/expense-history-index.test.ts
  - packages/contexts/forecasting/src/domain/robust-stats.test.ts
  - packages/contexts/forecasting/src/domain/spending-anomaly-detector.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["anomalies"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "\"Restaurantes\" tiene 12 gastos en los 365 días anteriores (60.00, 65.00, 70.00, 75.00, 78.00, 80.00, 80.00, 82.00, 85.00, 90.00, 95.00 y 100.00 BOB: mediana 80.00 BOB, MAD 7.50 BOB)"
  - "el 2026-11-12 se registra un gasto de 304.00 BOB en \"Restaurantes\""
expected_result:
  - "el gasto queda marcado como atípico por categoría con razón 3.8 y puntaje robusto ≥ 3.5"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-001 — Un gasto de 3,8 veces la mediana de su categoría se marca como atípico

## Intención

Verifica el scenario "Cena muy por encima de lo habitual" del requirement "Gastos atípicos para su categoría" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando "Restaurantes" tiene 12 gastos en los 365 días anteriores (60.00, 65.00, 70.00, 75.00, 78.00, 80.00, 80.00, 82.00, 85.00, 90.00, 95.00 y 100.00 BOB: mediana 80.00 BOB, MAD 7.50 BOB)
Y el 2026-11-12 se registra un gasto de 304.00 BOB en "Restaurantes"
Entonces el gasto queda marcado como atípico por categoría con razón 3.8 y puntaje robusto ≥ 3.5
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
