---
id: TC-REPORTING-UPCOMING-014
title: "Un pago vencido de un periodo anterior se muestra aparte y no suma al comprometido del periodo"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Total comprometido del periodo en el Home"
scenario: "Vencido de un periodo anterior mostrado aparte"
requirement_status: provisional
fr: ["FR-COMMITMENTS-011","FR-REPORTING-016"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ["committed","q4","overdue"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 salvo indicación"
  - "Cuenta \"Banco BOB\" (ASSET, líquida) con saldo contable 4000.00 BOB"
  - "Ocurrencias informadas por Commitments (doble de `UpcomingCommitmentsPort`)"
input: {"days":7}
steps:
  - "Agregar la ocurrencia no resuelta \"Seguro\" 120.00 BOB del 2026-09-28 al estado del TC-REPORTING-UPCOMING-013"
  - "Consultar el bloque committed"
expected_result:
  - "total del periodo 2026-10 = 999.88 BOB"
  - "overdueFromPreviousPeriods = 1 pago por 120.00 BOB"
created: 2026-10-09
updated: 2026-10-09
---

# TC-REPORTING-UPCOMING-014 — Un pago vencido de un periodo anterior se muestra aparte y no suma al comprometido del periodo

## Intención

El total del periodo es estable y lo vencido de meses anteriores no se esconde (pregunta abierta 4).

## Escenario

```gherkin
Dado Seguro de 120.00 BOB vencido el 2026-09-28 sin resolver
Cuando abro el Home el 2026-10-20
Entonces el comprometido de 2026-10 sigue en 999.88 BOB
  Y se muestran aparte 120.00 BOB vencidos de periodos anteriores
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
