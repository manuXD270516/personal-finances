---
id: TC-LEDGER-BALANCES-004
title: El saldo presentado invierte el signo en pasivos, ingresos y patrimonio
spec: ledger/balances
related_specs: []
requirement: Saldo presentado según la naturaleza de la cuenta
scenario: Deuda de tarjeta de crédito
requirement_status: confirmed
fr: [FR-LEDGER-002, FR-LEDGER-012]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/ledger/src/domain/balance-calculator.test.ts
  - packages/contexts/ledger/test/integration/pg-ledger.int.test.ts
status: automated
regression_suite: false
phase: 1
tags: [balances, sign-convention]
error_code: null
preconditions:
- 'Visa BOB (LIABILITY): -2000.00 (saldo inicial), -350.00 (compra), +350.00 (pago)'
- 'INCOME:BOB: -8000.00, -12.34'
- 'Bank A (ASSET): +595.50'
input:
  accounts:
  - Visa BOB
  - INCOME:BOB
  - Bank A
steps:
- Calcular saldo contable y saldo presentado de cada cuenta
expected_result:
- 'Visa BOB: contable -2000.00 BOB, presentado 2000.00 BOB adeudados'
- 'INCOME:BOB: contable -8012.34 BOB, presentado 8012.34 BOB'
- 'Bank A: contable y presentado 595.50 BOB'
created: &id001 2026-10-02
updated: 2026-10-03
---

# TC-LEDGER-BALANCES-004 — El saldo presentado invierte el signo en pasivos, ingresos y patrimonio

## Intención

El usuario debe ver su deuda e ingresos como números positivos sin conocer la convención contable (docs/09 §3).

## Escenario

```gherkin
Dado que "Visa BOB" tiene postings de -2000.00, -350.00 y +350.00 BOB
Cuando se presenta su saldo
Entonces se muestran 2000.00 BOB adeudados
```
