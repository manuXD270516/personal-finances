---
id: TC-FORECAST-ANOMALY-021
title: "Un gasto atípico de una transacción anulada no se muestra"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Cambios de la transacción después de la detección"
scenario: "Gasto anulado"
requirement_status: provisional
fr: ["FR-FORECAST-010"]
nfr: []
invariants: []
priority: medium
type: api
level: api
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
  - "se anula la transacción de un gasto atípico abierto"
  - "un miembro consulta la lista y la consulta por transactionId"
expected_result:
  - "ni la lista ni la consulta por transactionId lo devuelven"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-021 — Un gasto atípico de una transacción anulada no se muestra

## Intención

Verifica el scenario "Gasto anulado" del requirement "Cambios de la transacción después de la detección" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando se anula la transacción de un gasto atípico abierto
Y un miembro consulta la lista y la consulta por transactionId
Entonces ni la lista ni la consulta por transactionId lo devuelven
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
