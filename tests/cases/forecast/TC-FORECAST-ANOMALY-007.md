---
id: TC-FORECAST-ANOMALY-007
title: "Una contraparte nueva con un monto común no se marca"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Contraparte nueva con monto alto"
scenario: "Contraparte nueva con monto común"
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
  - "el percentil 95 de los gastos del workspace de los 365 días anteriores es 900.00 BOB"
  - "se registra un gasto de 120.00 BOB con una contraparte nueva"
expected_result:
  - "el gasto no se marca"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-007 — Una contraparte nueva con un monto común no se marca

## Intención

Verifica el scenario "Contraparte nueva con monto común" del requirement "Contraparte nueva con monto alto" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el percentil 95 de los gastos del workspace de los 365 días anteriores es 900.00 BOB
Y se registra un gasto de 120.00 BOB con una contraparte nueva
Entonces el gasto no se marca
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
