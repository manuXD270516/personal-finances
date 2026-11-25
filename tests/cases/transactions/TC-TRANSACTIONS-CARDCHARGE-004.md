---
id: TC-TRANSACTIONS-CARDCHARGE-004
title: "Las porciones de un cargo suman su monto y su asiento cuadra para componentes aleatorios"
spec: transactions/transaction-recording
related_specs: ["debt/credit-cards","ledger/journal-posting"]
requirement: "Transacciones de cargos de tarjeta administradas por la tarjeta"
scenario: null
requirement_status: provisional
fr: ["FR-DEBT-013"]
nfr: []
invariants: ["INV-004","INV-020","INV-021"]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 9
tags: ["credit-cards","card-charges"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; tarjeta \"Visa Oro\" bimoneda con \"Visa Oro BOB\" y \"Visa Oro USD\", cierre el día 25 y vencimiento el día 15"
  - "Datos del ciclo del 2026-09-26 al 2026-10-25 de \"Visa Oro BOB\" según el scenario «Ciclo de octubre de Visa Oro BOB» (saldo al cierre 1120.50 BOB) y una compra de 400.00 BOB el 2026-10-26"
  - "FixedClock en 2026-10-28T12:00 America/La_Paz salvo que el escenario diga otra fecha; datos ficticios"
input: {}
steps:
  - "se registran cargos con componentes aleatorios no negativos a la escala de BOB, USD y USDT, con al menos uno positivo"
expected_result:
  - "la suma de las porciones es igual al monto de la transacción"
  - "el asiento del cargo cuadra por moneda y la deuda de la cuenta aumenta exactamente el total"
created: 2026-11-25
updated: 2026-11-25
---
# TC-TRANSACTIONS-CARDCHARGE-004 — Las porciones de un cargo suman su monto y su asiento cuadra para componentes aleatorios

## Intención

Verifica el requirement "Transacciones de cargos de tarjeta administradas por la tarjeta" de `transactions/transaction-recording` (FR-DEBT-013).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando se registran cargos con componentes aleatorios no negativos a la escala de BOB, USD y USDT, con al menos uno positivo
Entonces la suma de las porciones es igual al monto de la transacción
Y el asiento del cargo cuadra por moneda y la deuda de la cuenta aumenta exactamente el total
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
- PBT con timeout explícito (CI es más lento).
