---
id: TC-TRANSACTIONS-CARDCHARGE-001
title: "El cargo de la tarjeta aparece en el listado con sus porciones y la tarjeta"
spec: transactions/transaction-recording
related_specs: ["debt/credit-cards"]
requirement: "Transacciones de cargos de tarjeta administradas por la tarjeta"
scenario: "Cargo de la tarjeta en el listado"
requirement_status: confirmed
fr: ["FR-DEBT-013","FR-TRANSACTIONS-009"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/web/src/ui/debt/cards/charges.test.tsx
status: automated
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
  - "el usuario lista las transacciones de \"Visa Oro BOB\" de octubre de 2026"
expected_result:
  - "ve el gasto de 4.80 BOB del 2026-10-25 con las porciones interés 4.00 BOB en \"Intereses pagados\" y seguro 0.80 BOB en \"Seguros\", identificado como cargo de \"Visa Oro\""
created: 2026-11-25
updated: 2026-11-25
---
# TC-TRANSACTIONS-CARDCHARGE-001 — El cargo de la tarjeta aparece en el listado con sus porciones y la tarjeta

## Intención

Verifica el scenario "Cargo de la tarjeta en el listado" del requirement "Transacciones de cargos de tarjeta administradas por la tarjeta" de `transactions/transaction-recording` (FR-DEBT-013, FR-TRANSACTIONS-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando el usuario lista las transacciones de "Visa Oro BOB" de octubre de 2026
Entonces ve el gasto de 4.80 BOB del 2026-10-25 con las porciones interés 4.00 BOB en "Intereses pagados" y seguro 0.80 BOB en "Seguros", identificado como cargo de "Visa Oro"
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
