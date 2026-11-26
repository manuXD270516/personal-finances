---
id: TC-DEBT-CARD-044
title: "Un cargo en dólares se registra en la cuenta USD de la tarjeta"
spec: debt/credit-cards
related_specs: []
requirement: "Registro de los intereses y cargos de una tarjeta"
scenario: "Cargo en dólares"
requirement_status: confirmed
fr: ["FR-DEBT-013"]
nfr: []
invariants: ["INV-002"]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/debt/src/application/card-charges.service.test.ts
  - packages/contexts/debt/src/domain/card-charge.test.ts
  - packages/contexts/transactions/src/application/card-charge-transactions.test.ts
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
  - "el EDITOR registra en \"Visa Oro USD\" un cargo con fecha 2026-10-25 de 1.25 USD de interés"
expected_result:
  - "se crea un gasto posteado de 1.25 USD en \"Visa Oro USD\" con una porción de 1.25 USD en \"Intereses pagados\" y la deuda de \"Visa Oro USD\" aumenta 1.25 USD"
created: 2026-11-25
updated: 2026-11-25
---
# TC-DEBT-CARD-044 — Un cargo en dólares se registra en la cuenta USD de la tarjeta

## Intención

Verifica el scenario "Cargo en dólares" del requirement "Registro de los intereses y cargos de una tarjeta" de `debt/credit-cards` (FR-DEBT-013).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando el EDITOR registra en "Visa Oro USD" un cargo con fecha 2026-10-25 de 1.25 USD de interés
Entonces se crea un gasto posteado de 1.25 USD en "Visa Oro USD" con una porción de 1.25 USD en "Intereses pagados" y la deuda de "Visa Oro USD" aumenta 1.25 USD
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
