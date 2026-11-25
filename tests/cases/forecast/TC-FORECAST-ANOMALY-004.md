---
id: TC-FORECAST-ANOMALY-004
title: "Con MAD igual a cero alcanza la razón con la mediana"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Gastos atípicos para su categoría"
scenario: "Montos siempre iguales"
requirement_status: confirmed
fr: ["FR-FORECAST-010"]
nfr: []
invariants: ["INV-020"]
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
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
  - "\"Lavandería\" tiene 10 gastos de 40.00 BOB en los 365 días anteriores"
  - "se registra un gasto de 132.00 BOB en \"Lavandería\""
expected_result:
  - "el gasto queda marcado como atípico por categoría con razón 3.3"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-004 — Con MAD igual a cero alcanza la razón con la mediana

## Intención

Verifica el scenario "Montos siempre iguales" del requirement "Gastos atípicos para su categoría" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando "Lavandería" tiene 10 gastos de 40.00 BOB en los 365 días anteriores
Y se registra un gasto de 132.00 BOB en "Lavandería"
Entonces el gasto queda marcado como atípico por categoría con razón 3.3
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
