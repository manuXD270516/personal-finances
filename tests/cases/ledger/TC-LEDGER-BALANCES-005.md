---
id: TC-LEDGER-BALANCES-005
title: El saldo contable ignora transacciones pendientes
spec: ledger/balances
related_specs: [accounts/account-management]
requirement: El saldo contable excluye transacciones pendientes
scenario: Gasto pendiente
requirement_status: confirmed
fr: [FR-LEDGER-013]
nfr: []
invariants: [INV-023]
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: [balances, pending]
error_code: null
preconditions:
- Bank A con saldo contable 1000.00 BOB
- Transacción pendiente de gasto por 200.00 BOB en Bank A (sin asiento)
input:
  account: Bank A
  pending: 200.00 BOB
steps:
- Consultar el saldo contable vía BalanceQuery
- Consultar el saldo proyectado expuesto por el consumidor (Accounts)
expected_result:
- Saldo contable = 1000.00 BOB
- No existe ningún asiento para la transacción pendiente
- El saldo proyectado 800.00 BOB se expone como un valor separado del saldo contable
created: &id001 2026-10-02
updated: *id001
---

# TC-LEDGER-BALANCES-005 — El saldo contable ignora transacciones pendientes

## Intención

FR-LEDGER-013: mezclar pendientes en el saldo contable haría que el ledger dependa de estados mutables.

## Escenario

```gherkin
Dado que "Bank A" tiene un saldo contable de 1000.00 BOB y un gasto pendiente de 200.00 BOB
Cuando se consulta su saldo contable
Entonces es 1000.00 BOB
```

## Notas

- El saldo proyectado lo arma Accounts con pendingAmount de Transactions; ver TC de accounts/account-management.
