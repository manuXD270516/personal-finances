---
id: TC-TRANSACTIONS-RECONCILIATION-020
title: "getCoverage cuenta como conciliada la cuenta conciliada sin extracto e informa su base"
spec: transactions/reconciliation
related_specs: ["planning/month-closing"]
requirement: "Estado de reconciliación por cuenta"
scenario: "Cuenta conciliada sin extracto"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-030, FR-PLANNING-003]
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 2
tags: ["coverage", "without-statement", "month-closing"]
error_code: null
preconditions:
  - "Cuenta \"Caja BOB\" (ASSET, BOB, ACTIVE, sin sesiones) con saldo inicial 500.00 BOB"
  - "Gasto C1 de 80.00 BOB del 2026-03-12 en \"Caja BOB\""
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "C1 conciliado sin extracto (única transacción de \"Caja BOB\" hasta el 2026-03-31)"
  - "\"Bank A\": sesión COMPLETED al 2026-03-31; luego gasto G4 de 12.00 BOB del 2026-03-30 registrado, confirmado y conciliado sin extracto; sin posted ni cleared hasta el 2026-03-31"
  - "\"USD Savings\": última sesión COMPLETED al 2026-02-28, sin movimientos en marzo"
input:
  from: "2026-03-01"
  through: "2026-03-31"
steps:
  - "ReconciliationStatusQuery.getCoverage para las tres cuentas"
expected_result:
  - "\"Caja BOB\": lastCompleted null, unreconciled 0/0, reconciledWithoutStatementCount 1, reconciledThrough true, reconciliationBasis WITHOUT_STATEMENT"
  - "\"Bank A\": reconciledThrough true, reconciliationBasis WITHOUT_STATEMENT, reconciledWithoutStatementCount 1"
  - "\"USD Savings\": reconciledThrough false, reconciliationBasis null (extracto anterior al corte y nada conciliado después)"
  - "GET W/accounts/{id}/reconciliation-status?asOf=2026-03-31&from=2026-03-01 devuelve la misma estructura"
created: 2026-10-08
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-020 — getCoverage cuenta como conciliada la cuenta conciliada sin extracto e informa su base

## Intención

Decisión docs/33 D111: para el cierre una cuenta conciliada sin extracto cuenta como conciliada, pero con base WITHOUT_STATEMENT para marcarla "pendiente de revisión". Fija la regla única del contrato con add-month-closing.

## Escenario

```gherkin
Dado "Caja BOB" con su único gasto de marzo conciliado sin extracto
Cuando se consulta el estado del 2026-03-01 al 2026-03-31
Entonces la cuenta está reconciliada al corte con base "sin extracto"
  Y tiene 1 conciliada sin extracto y 0 sin reconciliar
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
