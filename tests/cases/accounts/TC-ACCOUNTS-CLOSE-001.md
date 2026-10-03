---
id: TC-ACCOUNTS-CLOSE-001
title: "Una cuenta solo se cierra con saldo exactamente cero en su moneda"
spec: accounts/account-management
related_specs: ["ledger/balances"]
requirement: "Cierre de cuenta con saldo cero"
scenario: "Cierre con saldo pendiente"
requirement_status: confirmed
fr: [FR-ACCOUNTS-007]
nfr: []
invariants: [INV-022]
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/accounts/src/domain/account.test.ts
  - packages/contexts/accounts/src/application/accounts.service.test.ts
  - apps/api/test/api/accounts.api.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["accounts", "close"]
error_code: "ACCOUNT_BALANCE_NOT_ZERO"
preconditions:
  - "Bank B (savings, BOB) con saldo 0.00 BOB"
  - "USDT Wallet (crypto_wallet, USDT) con saldo 0.000001 USDT"
input:
  - {account: "Bank B", closedOn: "2026-03-31", expected: "CLOSED"}
  - {account: "USDT Wallet", closedOn: "2026-03-31", expected: "ACCOUNT_BALANCE_NOT_ZERO"}
steps: ["POST /accounts/{id}/close para cada cuenta"]
expected_result:
  - "Bank B queda CLOSED con closedOn 2026-03-31; se emite accounts.AccountClosed.v1 y se audita"
  - "USDT Wallet se rechaza con ACCOUNT_BALANCE_NOT_ZERO (409) y sigue ACTIVE con 0.000001 USDT"
created: 2026-10-02
updated: 2026-10-03
---

# TC-ACCOUNTS-CLOSE-001 — Una cuenta solo se cierra con saldo exactamente cero en su moneda

## Intención

FR-ACCOUNTS-007: cerrar con saldo escondería dinero o deuda; la comparación debe ser exacta a la escala de la moneda (incluso 0.000001 USDT).

## Escenario

```gherkin
Dado "USDT Wallet" con 0.000001 USDT
Cuando el usuario intenta cerrarla
Entonces se rechaza con ACCOUNT_BALANCE_NOT_ZERO
```
