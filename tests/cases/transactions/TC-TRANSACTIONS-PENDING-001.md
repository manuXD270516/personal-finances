---
id: TC-TRANSACTIONS-PENDING-001
title: "Las transacciones pendientes no afectan el ledger pero sí el saldo proyectado"
spec: transactions/transaction-recording
related_specs: ["ledger/balances"]
requirement: "Transacción pendiente sin asiento"
scenario: "Gasto pendiente luego posteado"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-006, FR-TRANSACTIONS-007, FR-LEDGER-006, FR-LEDGER-013]
nfr: []
invariants: [INV-023, INV-004]
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/transactions.service.test.ts
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["pending", "balances"]
error_code: null
preconditions: ["Bank A (BOB) con saldo contable 1000.00 BOB"]
input:
  expense: "80.00 BOB"
  status: "pending"
  date: "2026-03-20"
steps:
  - "Registrar el gasto pendiente"
  - "Leer el saldo contable y el saldo proyectado"
  - "Postear la transacción"
  - "Leer los saldos nuevamente"
expected_result:
  - "Mientras está pendiente: no existe ningún JournalEntry para ella; saldo contable 1000.00 BOB; saldo proyectado 920.00 BOB"
  - "Tras postearse: exactamente un JournalEntry activo con entryDate 2026-03-20; saldo contable 920.00 BOB; saldo proyectado 920.00 BOB"
  - "Se publican TransactionCreated (status PENDING) al registrar y TransactionPosted (previousStatus PENDING) al postear"
created: 2026-10-01
updated: 2026-10-02
---

# TC-TRANSACTIONS-PENDING-001 — Las transacciones pendientes no afectan el ledger pero sí el saldo proyectado

## Intención

Solo las transacciones posted | cleared | reconciled tienen asiento (ARCHITECTURE §4.1, INV-023).

## Escenario

```gherkin
Dado que "Bank A" tiene un saldo contable de 1000.00 BOB
Cuando se registra un gasto pendiente de 80.00 BOB
Entonces no existe ningún asiento para él
  Y el saldo proyectado es 920.00 BOB
Cuando el gasto se postea
Entonces el saldo contable es 920.00 BOB
```
