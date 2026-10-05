---
id: TC-TRANSACTIONS-RECONCILIATION-007
title: "Finalizar con diferencia distinta de cero sin ajuste se rechaza"
spec: transactions/reconciliation
related_specs: []
requirement: "Diferencia distinta de cero y ajuste de reconciliación"
scenario: "Finalizar con diferencia sin ajuste"
requirement_status: provisional
fr: [FR-TRANSACTIONS-030]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["reconciliation"]
error_code: "RECONCILIATION_DIFFERENCE_NOT_ZERO"
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE) con saldo inicial 1000.00 BOB al 2026-02-28"
  - "Gasto G1 cleared de 150.00 BOB del 2026-03-05; ingreso I1 cleared de 2500.00 BOB del 2026-03-10"
  - "Gasto G2 posted de 45.90 BOB del 2026-03-20; gasto G3 cleared de 200.00 BOB del 2026-04-02"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "Sesión de \"Bank A\" al 2026-03-31 por 3345.00 BOB (diferencia −5.00 BOB)"
input:
  adjustment: null
steps:
  - "POST complete sin ajuste"
expected_result:
  - "422 RECONCILIATION_DIFFERENCE_NOT_ZERO con difference \"-5.00\""
  - "Sesión IN_PROGRESS; ninguna transacción reconciled; sin auditoría nueva"
created: 2026-10-05
updated: 2026-10-05
---

# TC-TRANSACTIONS-RECONCILIATION-007 — Finalizar con diferencia distinta de cero sin ajuste se rechaza

## Intención

La diferencia debe llegar a cero: nunca se reconcilia "a medias".

## Escenario

```gherkin
Dado una sesión con diferencia −5.00 BOB
Cuando el usuario la finaliza sin ajuste
Entonces se rechaza con "RECONCILIATION_DIFFERENCE_NOT_ZERO"
  Y la sesión sigue en curso
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
