---
id: TC-REPORTING-UPCOMING-003
title: "Una ocurrencia de ingreso esperado no aparece en la lista de próximos pagos"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Lista de próximos pagos"
scenario: "Ingreso esperado no listado"
requirement_status: confirmed
fr: ["FR-REPORTING-016","FR-COMMITMENTS-011"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/upcoming-payments.queries.test.ts
  - packages/contexts/reporting/src/domain/upcoming-payments.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["upcoming-payments","q8"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 salvo indicación"
  - "Cuenta \"Banco BOB\" (ASSET, líquida) con saldo contable 4000.00 BOB"
  - "Ocurrencias informadas por Commitments (doble de `UpcomingCommitmentsPort`)"
input: {"days":30}
steps:
  - "Generar la ocurrencia de ingreso \"Sueldo\" 8000.00 BOB del 2026-10-25"
  - "Consultar los próximos pagos con days=30"
expected_result:
  - "\"Sueldo\" no aparece"
  - "El total no cambia por el ingreso"
created: 2026-10-09
updated: 2026-10-10
---

# TC-REPORTING-UPCOMING-003 — Una ocurrencia de ingreso esperado no aparece en la lista de próximos pagos

## Intención

Q8 pregunta por pagos (egresos); los ingresos esperados llegan con el calendario de Phase 7.

## Escenario

```gherkin
Dada la ocurrencia de ingreso Sueldo de 8000.00 BOB del 2026-10-25
Cuando consulto los próximos pagos de 30 días
Entonces Sueldo no aparece ni suma en el total
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
