---
id: TC-REPORTING-REPORTS-045
title: "Los costos recurrentes se normalizan a mes y año sin las suscripciones pausadas"
spec: reporting/financial-reports
related_specs: ["commitments/recurrence-engine"]
requirement: "Reporte de costos recurrentes"
scenario: "Tres compromisos en dos monedas"
requirement_status: confirmed
fr: ["FR-REPORTING-008", "FR-COMMITMENTS-011"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/domain/extended-reports.domain.test.ts
  - packages/contexts/reporting/src/application/extended-reports.queries.test.ts
  - packages/contexts/reporting/src/application/financial-reports.exports.test.ts
  - packages/contexts/commitments/src/application/recurring-cost.queries.test.ts
  - apps/api/test/api/financial-reports-extended.api.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["recurring"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Streaming 69.00 BOB mensual, seguro 1200.00 BOB anual, gimnasio 50.00 USD mensual activos; suscripción pausada 30.00 BOB mensual"
  - "USD/BOB vigente 10.00"
input: {}
steps:
  - "Calcular el reporte de costos recurrentes"
expected_result:
  - "Costo mensual total 669.00 BOB"
  - "Anualizado 8028.00 BOB"
  - "La pausada no suma; los variables se cuentan aparte sin monto"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-045 — Los costos recurrentes se normalizan a mes y año sin las suscripciones pausadas

## Intención

Reporte 11 con la regla as-built de normalización de Commitments.

## Escenario

```gherkin
Dado tres compromisos activos y uno pausado
Cuando se pide el reporte de costos recurrentes
Entonces el costo mensual es 669.00 BOB y el anual 8028.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.
