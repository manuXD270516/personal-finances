---
id: TC-DEBT-CARD-045
title: "Un cargo sin componentes positivos o con fecha futura se rechaza"
spec: debt/credit-cards
related_specs: []
requirement: "Registro de los intereses y cargos de una tarjeta"
scenario: "Cargo sin componentes positivos o con fecha futura"
requirement_status: confirmed
fr: ["FR-DEBT-013"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/card-charges.api.test.ts
  - apps/web/src/ui/debt/cards/charges.test.tsx
  - packages/contexts/debt/src/application/card-charges.service.test.ts
  - packages/contexts/debt/src/domain/card-charge.test.ts
  - packages/contexts/transactions/src/application/card-charge-transactions.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["credit-cards","card-charges"]
error_code: CARD_CHARGE_INVALID
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; tarjeta \"Visa Oro\" bimoneda con \"Visa Oro BOB\" y \"Visa Oro USD\", cierre el día 25 y vencimiento el día 15"
  - "Datos del ciclo del 2026-09-26 al 2026-10-25 de \"Visa Oro BOB\" según el scenario «Ciclo de octubre de Visa Oro BOB» (saldo al cierre 1120.50 BOB) y una compra de 400.00 BOB el 2026-10-26"
  - "FixedClock en 2026-10-28T12:00 America/La_Paz salvo que el escenario diga otra fecha; datos ficticios"
input: {}
steps:
  - "el 2026-10-28 el EDITOR registra en \"Visa Oro BOB\" un cargo con todos los componentes en 0.00 BOB, o un cargo de 4.00 BOB de interés con fecha 2026-10-30"
expected_result:
  - "se rechaza con `CARD_CHARGE_INVALID` y no se crea ninguna transacción"
created: 2026-11-25
updated: 2026-11-25
---
# TC-DEBT-CARD-045 — Un cargo sin componentes positivos o con fecha futura se rechaza

## Intención

Verifica el scenario "Cargo sin componentes positivos o con fecha futura" del requirement "Registro de los intereses y cargos de una tarjeta" de `debt/credit-cards` (FR-DEBT-013).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando el 2026-10-28 el EDITOR registra en "Visa Oro BOB" un cargo con todos los componentes en 0.00 BOB, o un cargo de 4.00 BOB de interés con fecha 2026-10-30
Entonces se rechaza con `CARD_CHARGE_INVALID` y no se crea ninguna transacción
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
