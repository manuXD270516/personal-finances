---
id: TC-DEBT-CARD-056
title: "La ida y vuelta del export conserva los cargos y su transacción"
spec: debt/credit-cards
related_specs: ["identity/workspace-portability"]
requirement: "Cargos de la tarjeta en la exportación del workspace"
scenario: "Ida y vuelta con un cargo vigente y uno anulado"
requirement_status: confirmed
fr: ["FR-IDENTITY-010","FR-DEBT-013"]
nfr: []
invariants: []
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/workspace-import.api.test.ts
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
  - "\"W1\" tiene en \"Visa Oro BOB\" el cargo vigente de 4.80 BOB del 2026-10-25 y un cargo anulado de 2.00 BOB del 2026-09-25, y el OWNER exporta e importa en un workspace nuevo"
expected_result:
  - "el workspace nuevo tiene los dos cargos con sus componentes y estados, cada uno vinculado a su transacción, y \"Visa Oro BOB\" adeuda lo mismo que en \"W1\""
created: 2026-11-25
updated: 2026-11-25
---
# TC-DEBT-CARD-056 — La ida y vuelta del export conserva los cargos y su transacción

## Intención

Verifica el scenario "Ida y vuelta con un cargo vigente y uno anulado" del requirement "Cargos de la tarjeta en la exportación del workspace" de `debt/credit-cards` (FR-IDENTITY-010, FR-DEBT-013).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando "W1" tiene en "Visa Oro BOB" el cargo vigente de 4.80 BOB del 2026-10-25 y un cargo anulado de 2.00 BOB del 2026-09-25, y el OWNER exporta e importa en un workspace nuevo
Entonces el workspace nuevo tiene los dos cargos con sus componentes y estados, cada uno vinculado a su transacción, y "Visa Oro BOB" adeuda lo mismo que en "W1"
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
