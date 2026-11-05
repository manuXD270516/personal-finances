---
id: TC-REPORTING-REPORTS-017
title: "A pedido, los flujos se valoran con la tasa de la fecha de corte y el nativo no cambia"
spec: reporting/financial-reports
related_specs: []
requirement: "Flujos valorados a la fecha de corte a pedido"
scenario: "Gasto en dólares a la fecha de corte"
requirement_status: confirmed
fr: ["FR-REPORTING-011"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/financial-reports.queries.test.ts
  - packages/contexts/reporting/src/domain/reports.domain.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["conversion-policy", "cutoff"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Gasto 50.00 USD el 2026-10-15; USD/BOB 10.50 al cierre del 2026-10-31"
input:
  conversion: "CUTOFF"
steps:
  - "Calcular el reporte de 2026-10 con conversion=CUTOFF"
expected_result:
  - "El gasto se valora en 525.00 BOB"
  - "meta.conversion.policy = CUTOFF_DATE con fecha 2026-10-31"
  - "El nativo sigue en 50.00 USD"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-017 — A pedido, los flujos se valoran con la tasa de la fecha de corte y el nativo no cambia

## Intención

FR-REPORTING-011 permite la tasa a fecha de corte como alternativa explícita.

## Escenario

```gherkin
Dado un gasto de 50.00 USD y USD/BOB 10.50 al 2026-10-31
Cuando se pide el reporte valorado a la fecha de corte
Entonces el gasto se valora en 525.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
