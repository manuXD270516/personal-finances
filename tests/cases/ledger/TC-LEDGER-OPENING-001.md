---
id: TC-LEDGER-OPENING-001
title: "El saldo inicial se registra contra EQUITY:OPENING_BALANCE en la moneda de la cuenta"
spec: ledger/journal-posting
related_specs: ["accounts/account-management"]
requirement: "Registro del saldo inicial"
scenario: null
requirement_status: provisional
fr: [FR-LEDGER-005, FR-ACCOUNTS-001]
nfr: []
invariants: [INV-002, INV-004]
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["opening-balance"]
error_code: null
preconditions:
  - "Workspace W1 todavía sin la cuenta contable EQUITY:OPENING_BALANCE:BOB"
input:
  - account: "Bank C"
    kind: "ASSET"
    currency: "BOB"
    opening_balance: "2500.00"
    date: "2026-01-01"
  - account: "Card X"
    kind: "LIABILITY"
    currency: "BOB"
    opening_balance_owed: "800.00"
    date: "2026-01-01"
steps:
  - "Crear Bank C con un saldo inicial de 2500.00 BOB"
  - "Crear Card X con una deuda inicial de 800.00 BOB"
expected_result:
  - "EQUITY:OPENING_BALANCE:BOB se crea bajo demanda (una sola vez)"
  - "Asiento de Bank C: Bank C +2500.00, EQUITY:OPENING_BALANCE:BOB -2500.00"
  - "Asiento de Card X: Card X -800.00, EQUITY:OPENING_BALANCE:BOB +800.00"
  - "Patrimonio neto = 2500.00 - 800.00 = 1700.00 BOB"
  - "No se crea ningún posting de INCOME"
created: 2026-10-01
updated: 2026-10-01
---

# TC-LEDGER-OPENING-001 — El saldo inicial se registra contra EQUITY:OPENING_BALANCE en la moneda de la cuenta

## Intención

Los saldos iniciales no deben contarse como ingreso; son patrimonio (equity) en la misma moneda que la cuenta.

## Escenario

```gherkin
Dado que no existe una cuenta de patrimonio de saldo inicial para BOB
Cuando se crea la cuenta "Bank C" con un saldo inicial de 2500.00 BOB
Entonces se debita 2500.00 BOB a "Bank C"
  Y se acredita 2500.00 BOB a "EQUITY:OPENING_BALANCE:BOB"
  Y el ingreso del mes no cambia
```
