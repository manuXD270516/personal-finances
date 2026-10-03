---
id: TC-REPORTING-KPI-007
title: "La comparación con el mes anterior es a la misma fecha y marca \"nuevo\" si el anterior es cero"
spec: reporting/dashboard
related_specs: []
requirement: "Comparación básica con el mes anterior"
scenario: "Gastos a la fecha contra agosto"
requirement_status: confirmed
fr: ["FR-REPORTING-004","FR-REPORTING-018"]
nfr: ["NFR-USAB-004"]
invariants: []
priority: high
type: unit
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/report-summary.queries.test.ts
  - packages/contexts/reporting/src/domain/period-comparator.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["kpi","mom"]
error_code: null
preconditions:
  - "FixedClock en 2026-09-15T12:00:00-04:00"
  - "Gastos 2026-09-01..15 = 1305.00 BOB; 2026-08-01..15 = 1200.00 BOB"
  - "Ingresos de agosto = 0.00 BOB; de septiembre = 8000.00 BOB"
input: {"compare":"PREVIOUS_PERIOD_TO_DATE","edge":{"today":"2026-10-31","previous_range":"2026-09-01..2026-09-30"}}
steps:
  - "Calcular la comparación de gastos e ingresos"
  - "Calcular el rango anterior para el 2026-10-31"
expected_result:
  - "Gastos: +105.00 BOB y +8.75 % con semántica de aumento de gasto"
  - "Ingresos: +8000.00 BOB, deltaPct null, isNew = true"
  - "Borde: el 31 de octubre se compara contra 1..30 de septiembre"
created: 2026-10-02
updated: 2026-10-03
---

# TC-REPORTING-KPI-007 — La comparación con el mes anterior es a la misma fecha y marca "nuevo" si el anterior es cero

## Intención

docs/14 §6: comparar medio mes contra un mes completo engaña.

## Escenario

```gherkin
Dado que hoy es 2026-09-15
Cuando comparo los gastos del 1 al 15 de septiembre (1305.00 BOB) con los del 1 al 15 de agosto (1200.00 BOB)
Entonces la variación es +105.00 BOB y +8.75 %
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
