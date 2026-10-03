---
id: TC-ACCOUNTS-LIST-001
title: "El listado de cuentas muestra el saldo en su moneda y el equivalente en BOB con fecha y fuente de la tasa"
spec: accounts/account-management
related_specs: ["fx/market-rates", "ledger/balances"]
requirement: "Listado de cuentas con saldo y equivalente en moneda base"
scenario: "Equivalente con tasa registrada"
requirement_status: confirmed
fr: [FR-ACCOUNTS-010]
nfr: [NFR-PERF-005]
invariants: [INV-012, INV-020]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/web/src/ui/accounts/AccountsListView.test.tsx
  - tests/e2e/specs/accounts.spec.ts
status: automated
regression_suite: false
phase: 1
tags: ["accounts", "multi-currency", "fx"]
error_code: null
preconditions:
  - "W1 con moneda base BOB; FixedClock 2026-03-15"
  - "USD Savings con 500.00 USD; tasa manual USD→BOB 6.96 fechada 2026-03-14"
  - "BTC Wallet con 0.01250000 BTC y sin tasa BTC→BOB"
  - "Credit Card adeuda 350.00 BOB"
input:
  request: "GET /workspaces/W1/accounts"
steps: ["Listar cuentas"]
expected_result:
  - "USD Savings: balance 500.00 USD; baseCurrencyBalance 3480.00 BOB con rateDate 2026-03-14 y rateSource manual"
  - "BTC Wallet: balance 0.01250000 BTC; baseCurrencyBalance null con indicación de equivalente no disponible"
  - "Credit Card: balance 350.00 BOB presentado como adeudado; baseCurrencyBalance 350.00 BOB"
  - "Ningún equivalente se persiste; registrar luego una tasa USD→BOB 6.97 cambia el equivalente mostrado sin alterar transacciones históricas"
created: 2026-10-02
updated: 2026-10-03
---

# TC-ACCOUNTS-LIST-001 — El listado de cuentas muestra el saldo en su moneda y el equivalente en BOB con fecha y fuente de la tasa

## Intención

FR-ACCOUNTS-010: el usuario ve cuánto tiene en cada moneda y su referencia en BOB, con transparencia sobre la tasa y sin inventar valores.

## Escenario

```gherkin
Dado "USD Savings" con 500.00 USD y la tasa USD→BOB 6.96 del 2026-03-14
Cuando el usuario lista sus cuentas
Entonces ve 500.00 USD y su equivalente 3480.00 BOB con la fecha y la fuente de la tasa
```
