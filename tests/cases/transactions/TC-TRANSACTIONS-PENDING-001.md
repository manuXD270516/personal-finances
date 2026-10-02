---
id: TC-TRANSACTIONS-PENDING-001
title: "Las transacciones pendientes no afectan el ledger pero sí el saldo proyectado"
spec: transactions/transaction-recording
related_specs: ["ledger/balances"]
requirement: "Ciclo de vida del estado de la transacción"
scenario: null
requirement_status: provisional
fr: [FR-TRANSACTIONS-006]
nfr: []
invariants: [INV-004]
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["pending", "balances"]
error_code: null
preconditions: ["Bank A (BOB) con saldo contable 1000.00"]
input:
  expense: "80.00 BOB"
  status: "pending"
  date: "2026-03-20"
steps:
  - "Registrar el gasto pendiente"
  - "Leer el saldo contable y el saldo proyectado"
  - "Marcar la transacción como posted"
  - "Leer los saldos nuevamente"
expected_result:
  - "Mientras está pendiente: no existe ningún JournalEntry para ella; saldo contable 1000.00; saldo proyectado 920.00"
  - "Tras registrarse (posted): exactamente un JournalEntry; saldo contable 920.00; saldo proyectado 920.00"
created: 2026-10-01
updated: 2026-10-01
---

# TC-TRANSACTIONS-PENDING-001 — Las transacciones pendientes no afectan el ledger pero sí el saldo proyectado

## Intención

Solo las transacciones posted | cleared | reconciled tienen asientos (ARCHITECTURE §4.1).

## Escenario

```gherkin
Dado que "Bank A" tiene un saldo contable de 1000.00 BOB
Cuando se registra un gasto pendiente de 80.00 BOB
Entonces no existe ningún asiento para él
  Y el saldo proyectado es 920.00 BOB
Cuando el gasto se marca como posted
Entonces el saldo contable es 920.00 BOB
```
