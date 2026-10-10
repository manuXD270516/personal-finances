---
id: TC-REPORTING-UPCOMING-005
title: "Un pago vencido sin resolver se lista primero, marcado con sus días de atraso, hasta resolverse"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Pagos vencidos sin resolver marcados"
scenario: "Netflix vencido"
requirement_status: confirmed
fr: ["FR-REPORTING-016","FR-COMMITMENTS-011"]
nfr: []
invariants: []
priority: critical
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
  - "Workspace \"W1\" con moneda de reporte BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Ocurrencias no resueltas \"Netflix\" 49.00 BOB (2026-10-15, OVERDUE) e \"Internet\" 199.00 BOB (2026-10-22)"
input: {"days":30}
steps:
  - "Consultar los próximos pagos con days=30"
  - "Vincular \"Netflix\" a un gasto posteado de 49.00 BOB del 2026-10-20"
  - "Consultar de nuevo"
expected_result:
  - "Primera consulta: Netflix (vencido, 5 días de atraso), Internet; total 248.00 BOB"
  - "Segunda consulta: solo Internet; total 199.00 BOB"
created: 2026-10-09
updated: 2026-10-10
---

# TC-REPORTING-UPCOMING-005 — Un pago vencido sin resolver se lista primero, marcado con sus días de atraso, hasta resolverse

## Intención

Lo que se debe y no se pagó es lo más accionable de Q8; ocultarlo por quedar antes de la ventana produciría pagos sorpresa (SM-07).

## Escenario

```gherkin
Dada Netflix de 49.00 BOB vencida el 2026-10-15 e Internet de 199.00 BOB del 2026-10-22
Cuando consulto los próximos pagos el 2026-10-20
Entonces Netflix aparece primero como vencida con 5 días de atraso
  Y el total es 248.00 BOB
Cuando vinculo Netflix a un gasto posteado de 49.00 BOB
Entonces la lista solo contiene Internet por 199.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
