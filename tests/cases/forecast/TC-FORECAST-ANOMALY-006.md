---
id: TC-FORECAST-ANOMALY-006
title: "Una contraparte sin gastos previos con monto sobre el percentil 95 se marca"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Contraparte nueva con monto alto"
scenario: "Compra grande con una tienda desconocida"
requirement_status: provisional
fr: ["FR-FORECAST-010"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
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
  - "el 2026-11-14 se registra un gasto de 1450.00 BOB con \"Tienda Online Nueva\", sin gastos previos"
expected_result:
  - "el gasto queda marcado con el motivo NEW_COUNTERPARTY_HIGH_AMOUNT y referencia 900.00 BOB"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-006 — Una contraparte sin gastos previos con monto sobre el percentil 95 se marca

## Intención

Verifica el scenario "Compra grande con una tienda desconocida" del requirement "Contraparte nueva con monto alto" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el percentil 95 de los gastos del workspace de los 365 días anteriores es 900.00 BOB
Y el 2026-11-14 se registra un gasto de 1450.00 BOB con "Tienda Online Nueva", sin gastos previos
Entonces el gasto queda marcado con el motivo NEW_COUNTERPARTY_HIGH_AMOUNT y referencia 900.00 BOB
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
