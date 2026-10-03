---
id: TC-TRANSACTIONS-ADJUSTMENT-001
title: "Un ajuste con motivo se contabiliza contra ajustes de patrimonio sin afectar ingresos ni gastos"
spec: transactions/transaction-recording
related_specs: ["ledger/journal-posting"]
requirement: "Ajustes de saldo"
scenario: "Ajuste por diferencia con el extracto"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-017, FR-ACCOUNTS-006]
nfr: []
invariants: [INV-004]
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["adjustment", "equity"]
error_code: "VALIDATION_FAILED"
preconditions: ["Bank A (BOB) con saldo 1250.00 BOB"]
input:
  - kind: "ADJUSTMENT"
    direction: "DECREASE"
    amount: "15.44 BOB"
    reason: "diferencia con extracto de marzo"
    date: "2026-03-31"
  - kind: "ADJUSTMENT"
    direction: "DECREASE"
    amount: "15.44 BOB"
    reason: null
steps:
  - "Registrar el ajuste con motivo"
  - "Registrar el ajuste sin motivo"
  - "Consultar ingresos y gastos de marzo"
expected_result:
  - "Asiento: Bank A -15.44 BOB; EQUITY:ADJUSTMENTS:BOB +15.44 BOB; suma 0.00 BOB"
  - "Saldo de Bank A = 1234.56 BOB; la transacción es kind ADJUSTMENT con su motivo"
  - "Ingresos y gastos de marzo sin cambios"
  - "Sin motivo: 400/422 con code VALIDATION_FAILED señalando el campo reason; nada persistido"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-ADJUSTMENT-001 — Un ajuste con motivo se contabiliza contra ajustes de patrimonio sin afectar ingresos ni gastos

## Intención

docs/09 §6.6: diferencias sin origen identificado se registran contra EQUITY:ADJUSTMENTS y quedan visibles.

## Escenario

```gherkin
Dado que "Bank A" tiene 1250.00 BOB
Cuando el usuario registra un ajuste de disminución de 15.44 BOB con motivo
Entonces el saldo de "Bank A" es 1234.56 BOB
  Y los ingresos y gastos del mes no cambian
```
