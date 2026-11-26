---
id: TC-REPORTING-REPORTS-062
title: "Un cargo de tarjeta anulado deja de contarse en el reporte de comisiones"
spec: reporting/financial-reports
related_specs: ["debt/credit-cards"]
requirement: "Reporte de comisiones"
scenario: "Cargo anulado"
requirement_status: confirmed
fr: ["FR-REPORTING-008","FR-DEBT-013"]
nfr: []
invariants: []
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/card-charges.api.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["reports","fees","card-charges"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; tarjeta \"Visa Oro\" bimoneda con \"Visa Oro BOB\" y \"Visa Oro USD\", cierre el día 25 y vencimiento el día 15"
  - "Datos del ciclo del 2026-09-26 al 2026-10-25 de \"Visa Oro BOB\" según el scenario «Ciclo de octubre de Visa Oro BOB» (saldo al cierre 1120.50 BOB) y una compra de 400.00 BOB el 2026-10-26"
  - "FixedClock en 2026-10-28T12:00 America/La_Paz salvo que el escenario diga otra fecha; datos ficticios"
input: {}
steps:
  - "el cargo de 4.80 BOB del 2026-10-25 de \"Visa Oro BOB\" se anula"
expected_result:
  - "el reporte de 2026-10 informa tarjetas 0.00 BOB"
created: 2026-11-25
updated: 2026-11-25
---
# TC-REPORTING-REPORTS-062 — Un cargo de tarjeta anulado deja de contarse en el reporte de comisiones

## Intención

Verifica el scenario "Cargo anulado" del requirement "Reporte de comisiones" de `reporting/financial-reports` (FR-REPORTING-008, FR-DEBT-013).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando el cargo de 4.80 BOB del 2026-10-25 de "Visa Oro BOB" se anula
Entonces el reporte de 2026-10 informa tarjetas 0.00 BOB
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
