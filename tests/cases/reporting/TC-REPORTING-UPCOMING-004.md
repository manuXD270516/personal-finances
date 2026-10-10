---
id: TC-REPORTING-UPCOMING-004
title: "Una ventana de 91 días se rechaza con INVALID_FILTER"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Lista de próximos pagos"
scenario: "Ventana fuera de rango"
requirement_status: provisional
fr: ["FR-REPORTING-016","FR-COMMITMENTS-011"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ["upcoming-payments","q8"]
error_code: INVALID_FILTER
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 salvo indicación"
  - "Cuenta \"Banco BOB\" (ASSET, líquida) con saldo contable 4000.00 BOB"
  - "Ocurrencias informadas por Commitments (doble de `UpcomingCommitmentsPort`)"
input: {"days":91}
steps:
  - "GET W/reports/upcoming-payments?days=91"
expected_result:
  - "400 con código INVALID_FILTER"
created: 2026-10-09
updated: 2026-10-09
---

# TC-REPORTING-UPCOMING-004 — Una ventana de 91 días se rechaza con INVALID_FILTER

## Intención

La ventana se limita al horizonte de generación (90 días); más allá no hay ocurrencias generadas y el resultado sería engañoso.

## Escenario

```gherkin
Cuando pido los próximos pagos de 91 días
Entonces la respuesta es 400 con INVALID_FILTER
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
