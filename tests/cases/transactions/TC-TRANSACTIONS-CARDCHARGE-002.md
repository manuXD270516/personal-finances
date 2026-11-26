---
id: TC-TRANSACTIONS-CARDCHARGE-002
title: "Cambiar el monto de un cargo desde transacciones se rechaza"
spec: transactions/transaction-recording
related_specs: ["debt/credit-cards"]
requirement: "Transacciones de cargos de tarjeta administradas por la tarjeta"
scenario: "Cambiar el monto del cargo desde transacciones"
requirement_status: confirmed
fr: ["FR-DEBT-013","FR-TRANSACTIONS-009"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/card-charges.api.test.ts
  - packages/contexts/transactions/src/application/card-charge-transactions.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["credit-cards","card-charges"]
error_code: TRANSACTION_MANAGED_EXTERNALLY
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; tarjeta \"Visa Oro\" bimoneda con \"Visa Oro BOB\" y \"Visa Oro USD\", cierre el día 25 y vencimiento el día 15"
  - "Datos del ciclo del 2026-09-26 al 2026-10-25 de \"Visa Oro BOB\" según el scenario «Ciclo de octubre de Visa Oro BOB» (saldo al cierre 1120.50 BOB) y una compra de 400.00 BOB el 2026-10-26"
  - "FixedClock en 2026-10-28T12:00 America/La_Paz salvo que el escenario diga otra fecha; datos ficticios"
input: {}
steps:
  - "el EDITOR cambia desde transacciones el monto del cargo de 4.80 BOB a 5.00 BOB"
expected_result:
  - "se rechaza con `TRANSACTION_MANAGED_EXTERNALLY` y el cargo sigue en 4.80 BOB"
created: 2026-11-25
updated: 2026-11-25
---
# TC-TRANSACTIONS-CARDCHARGE-002 — Cambiar el monto de un cargo desde transacciones se rechaza

## Intención

Verifica el scenario "Cambiar el monto del cargo desde transacciones" del requirement "Transacciones de cargos de tarjeta administradas por la tarjeta" de `transactions/transaction-recording` (FR-DEBT-013, FR-TRANSACTIONS-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando el EDITOR cambia desde transacciones el monto del cargo de 4.80 BOB a 5.00 BOB
Entonces se rechaza con `TRANSACTION_MANAGED_EXTERNALLY` y el cargo sigue en 4.80 BOB
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
