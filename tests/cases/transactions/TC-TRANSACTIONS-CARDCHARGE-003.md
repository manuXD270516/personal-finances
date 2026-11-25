---
id: TC-TRANSACTIONS-CARDCHARGE-003
title: "Agregar una nota a un cargo no toca el ledger"
spec: transactions/transaction-recording
related_specs: ["debt/credit-cards"]
requirement: "Transacciones de cargos de tarjeta administradas por la tarjeta"
scenario: "Nota en el cargo"
requirement_status: provisional
fr: ["FR-DEBT-013","FR-TRANSACTIONS-009"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["credit-cards","card-charges"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; tarjeta \"Visa Oro\" bimoneda con \"Visa Oro BOB\" y \"Visa Oro USD\", cierre el día 25 y vencimiento el día 15"
  - "Datos del ciclo del 2026-09-26 al 2026-10-25 de \"Visa Oro BOB\" según el scenario «Ciclo de octubre de Visa Oro BOB» (saldo al cierre 1120.50 BOB) y una compra de 400.00 BOB el 2026-10-26"
  - "FixedClock en 2026-10-28T12:00 America/La_Paz salvo que el escenario diga otra fecha; datos ficticios"
input: {}
steps:
  - "el EDITOR agrega la nota \"interés por pago parcial de septiembre\" al cargo de 4.80 BOB"
expected_result:
  - "la nota queda registrada y el asiento del cargo no cambia"
created: 2026-11-25
updated: 2026-11-25
---
# TC-TRANSACTIONS-CARDCHARGE-003 — Agregar una nota a un cargo no toca el ledger

## Intención

Verifica el scenario "Nota en el cargo" del requirement "Transacciones de cargos de tarjeta administradas por la tarjeta" de `transactions/transaction-recording` (FR-DEBT-013, FR-TRANSACTIONS-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando el EDITOR agrega la nota "interés por pago parcial de septiembre" al cargo de 4.80 BOB
Entonces la nota queda registrada y el asiento del cargo no cambia
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
