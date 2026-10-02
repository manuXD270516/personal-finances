---
id: TC-ACCOUNTS-CURRENCY-002
title: "La moneda de una cuenta solo puede cambiarse mientras no tenga movimientos"
spec: accounts/account-management
related_specs: ["ledger/journal-posting"]
requirement: "Moneda inmutable con movimientos"
scenario: "Cuenta con movimientos"
requirement_status: confirmed
fr: [FR-ACCOUNTS-005]
nfr: []
invariants: [INV-006]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["accounts", "multi-currency"]
error_code: "ACCOUNT_CURRENCY_IMMUTABLE"
preconditions:
  - "Bank C (bank, BOB) con un ingreso de 200.00 BOB"
  - "Bank D (bank, BOB) sin saldo inicial ni movimientos"
input:
  - {account: "Bank C", new_currency: "USD"}
  - {account: "Bank D", new_currency: "USD"}
steps: ["Intentar cambiar la moneda de cada cuenta a USD"]
expected_result:
  - "Bank C: se rechaza con ACCOUNT_CURRENCY_IMMUTABLE; sigue en BOB con saldo 200.00 BOB"
  - "Bank D: queda en USD con saldo 0.00 USD y el cambio se audita"
created: 2026-10-02
updated: 2026-10-02
---

# TC-ACCOUNTS-CURRENCY-002 — La moneda de una cuenta solo puede cambiarse mientras no tenga movimientos

## Intención

INV-006: la moneda de los postings debe coincidir con la de su cuenta; cambiarla con historia rompería el ledger (FR-ACCOUNTS-005).

## Escenario

```gherkin
Dado "Bank C" en BOB con un ingreso de 200.00 BOB
Cuando el usuario intenta cambiar su moneda a USD
Entonces se rechaza con ACCOUNT_CURRENCY_IMMUTABLE
```
