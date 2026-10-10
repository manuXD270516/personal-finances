---
id: TC-GOALS-SAVINGS-048
title: "Los aportes netos a metas del mes se informan junto al ahorro sin cambiar el ahorro ni la tasa"
spec: reporting/dashboard
related_specs: ["goals/savings-goals"]
requirement: "Aportes a metas del mes en el ahorro"
scenario: "Aportes de octubre"
requirement_status: provisional
fr: ["FR-REPORTING-002", "FR-GOALS-003"]
nfr: []
invariants: []
priority: low
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "home", "q6"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "En \"2026-10\": aporte real 1000.00 BOB, reserva 2000.00 BOB, liberación 500.00 BOB y reasignación de 1000.00 BOB entre metas"
  - "Ingresos 8000.00 BOB y gastos 1305.00 BOB"
input: {}
steps:
  - "GET W/reports/summary"
expected_result:
  - "goalContributions.base = 2500.00 BOB"
  - "Ahorro 6695.00 BOB y tasa 83.7 % sin cambios"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-048 — Los aportes netos a metas del mes se informan junto al ahorro sin cambiar el ahorro ni la tasa

## Intención

Q6 Phase 4 ("aportes efectivos a metas") sin alterar el ahorro del ledger.

## Escenario

```gherkin
Dados en octubre un aporte de 1000.00 BOB, una reserva de 2000.00 BOB y una liberación de 500.00 BOB
Cuando consulto el resumen
Entonces los aportes netos a metas son 2500.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
