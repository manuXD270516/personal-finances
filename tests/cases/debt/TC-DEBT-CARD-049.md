---
id: TC-DEBT-CARD-049
title: "Anular un cargo revierte su asiento y la deuda de la tarjeta"
spec: debt/credit-cards
related_specs: []
requirement: "Anular un cargo de la tarjeta"
scenario: "Cargo registrado por error"
requirement_status: confirmed
fr: ["FR-DEBT-013"]
nfr: []
invariants: ["INV-007","INV-008"]
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/card-charges.api.test.ts
  - packages/contexts/debt/src/application/card-charges.service.test.ts
  - packages/contexts/debt/src/domain/card-charge.test.ts
  - packages/contexts/transactions/src/application/card-charge-transactions.test.ts
  - tests/e2e/specs/card-charges.spec.ts
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
  - "el EDITOR anula con el motivo \"monto equivocado\" el cargo de 4.80 BOB del 2026-10-25 de \"Visa Oro BOB\", que adeuda 1525.30 BOB"
expected_result:
  - "la transacción del cargo queda anulada con la reversa de su asiento y \"Visa Oro BOB\" adeuda 1520.50 BOB"
  - "las compras del ciclo del 2026-09-26 al 2026-10-25 vuelven a 1170.50 BOB"
created: 2026-11-25
updated: 2026-11-25
---
# TC-DEBT-CARD-049 — Anular un cargo revierte su asiento y la deuda de la tarjeta

## Intención

Verifica el scenario "Cargo registrado por error" del requirement "Anular un cargo de la tarjeta" de `debt/credit-cards` (FR-DEBT-013).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando el EDITOR anula con el motivo "monto equivocado" el cargo de 4.80 BOB del 2026-10-25 de "Visa Oro BOB", que adeuda 1525.30 BOB
Entonces la transacción del cargo queda anulada con la reversa de su asiento y "Visa Oro BOB" adeuda 1520.50 BOB
Y las compras del ciclo del 2026-09-26 al 2026-10-25 vuelven a 1170.50 BOB
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
