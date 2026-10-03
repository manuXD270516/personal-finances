---
id: TC-LEDGER-BALANCES-003
title: Los saldos de varias cuentas se agregan por moneda sin mezclar monedas
spec: ledger/balances
related_specs: []
requirement: Saldos agregados por moneda
scenario: Cuentas en BOB y USDT
requirement_status: confirmed
fr: [FR-LEDGER-012]
nfr: []
invariants: [INV-002]
priority: high
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/ledger/test/integration/pg-ledger.int.test.ts
status: automated
regression_suite: false
phase: 1
tags: [balances, multi-currency]
error_code: null
preconditions:
- Bank A 595.50 BOB, Efectivo BOB 200.00 BOB, Binance USDT 99.900000 USDT
input:
  accounts:
  - Bank A
  - Efectivo BOB
  - Binance USDT
steps:
- Ejecutar GetBalances para las tres cuentas
expected_result:
- Devuelve el saldo de cada cuenta
- 'Totales: 795.50 BOB y 99.900000 USDT, por separado'
- No existe ningún total que combine BOB y USDT
created: &id001 2026-10-02
updated: 2026-10-03
---

# TC-LEDGER-BALANCES-003 — Los saldos de varias cuentas se agregan por moneda sin mezclar monedas

## Intención

Sumar monedas distintas sin conversión explícita violaría INV-002 y daría un total sin sentido.

## Escenario

```gherkin
Dado "Bank A" con 595.50 BOB, "Efectivo BOB" con 200.00 BOB y "Binance USDT" con 99.900000 USDT
Cuando se consultan sus saldos
Entonces los totales son 795.50 BOB y 99.900000 USDT por separado
```
