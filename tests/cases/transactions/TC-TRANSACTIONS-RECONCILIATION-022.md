---
id: TC-TRANSACTIONS-RECONCILIATION-022
title: "El cotejo posterior omite las conciliadas sin extracto de un mes cerrado sin impedir la sesión"
spec: transactions/reconciliation
related_specs: ["planning/month-closing"]
requirement: "Cotejo posterior de las conciliadas sin extracto"
scenario: "Conciliada sin extracto en un mes cerrado"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-030]
nfr: []
invariants: [INV-015]
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/reconciliation.api.test.ts
  - packages/contexts/transactions/src/application/reconciliations.service.test.ts
status: automated
regression_suite: false
phase: 2
tags: ["without-statement", "period-closed", "session"]
error_code: null
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE)"
  - "Periodo \"2026-03\" cerrado"
  - "Gasto G5 de 30.00 BOB del 2026-03-28 conciliado sin extracto; ninguna transacción cleared de marzo"
  - "Sesión de \"Bank A\" al 2026-04-30 en curso con diferencia 0.00 BOB"
  - "FixedClock 2026-05-05T12:00:00-04:00 (America/La_Paz)"
input:
  statementDate: "2026-04-30"
steps:
  - "Finalizar la sesión"
expected_result:
  - "Sesión COMPLETED sin PERIOD_CLOSED"
  - "G5 conserva reconciliationMode WITHOUT_STATEMENT y systemFlags [RECONCILED_WITHOUT_STATEMENT]; sin reconciliation_item ni anotación"
created: 2026-10-08
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-022 — El cotejo posterior omite las conciliadas sin extracto de un mes cerrado sin impedir la sesión

## Intención

Decisión docs/33 D111 + D65: las de periodos cerrados no se tocan (el snapshot ya las registró como sin extracto), pero no deben bloquear la conciliación de meses abiertos.

## Escenario

```gherkin
Dado marzo cerrado y un gasto de 30.00 BOB del 2026-03-28 conciliado sin extracto
Cuando se finaliza una sesión de "Bank A" al 2026-04-30 con diferencia 0.00 BOB
Entonces la sesión queda COMPLETED
  Y el gasto conserva el modo sin extracto y la marca
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
