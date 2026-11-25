---
id: TC-REPORTING-REPORTS-063
title: "Los cargos de tarjeta suman lo mismo en el reporte de deudas y en el de comisiones"
spec: reporting/financial-reports
related_specs: ["debt/credit-cards"]
requirement: "Reconciliación de los reportes ampliados con el ledger"
scenario: "Cargos de tarjeta iguales en los dos reportes"
requirement_status: provisional
fr: ["FR-REPORTING-008","FR-REPORTING-010"]
nfr: ["NFR-DATA-008"]
invariants: ["INV-021"]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 9
tags: ["reports","reconciliation","card-charges"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; tarjeta \"Visa Oro\" bimoneda con \"Visa Oro BOB\" y \"Visa Oro USD\", cierre el día 25 y vencimiento el día 15"
  - "Datos del ciclo del 2026-09-26 al 2026-10-25 de \"Visa Oro BOB\" según el scenario «Ciclo de octubre de Visa Oro BOB» (saldo al cierre 1120.50 BOB) y una compra de 400.00 BOB el 2026-10-26"
  - "FixedClock en 2026-10-28T12:00 America/La_Paz salvo que el escenario diga otra fecha; datos ficticios"
input: {}
steps:
  - "en 2026-10 \"Visa Oro BOB\" tiene cargos vigentes por 4.80 BOB y \"Visa Oro USD\" por 1.25 USD"
expected_result:
  - "el reporte de deudas suma 4.80 BOB y 1.25 USD de interés y cargos de tarjetas en 2026-10 y el tipo tarjetas del reporte de comisiones informa 4.80 BOB y 1.25 USD en 2026-10"
created: 2026-11-25
updated: 2026-11-25
---
# TC-REPORTING-REPORTS-063 — Los cargos de tarjeta suman lo mismo en el reporte de deudas y en el de comisiones

## Intención

Verifica el scenario "Cargos de tarjeta iguales en los dos reportes" del requirement "Reconciliación de los reportes ampliados con el ledger" de `reporting/financial-reports` (FR-REPORTING-008, FR-REPORTING-010, NFR-DATA-008).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando en 2026-10 "Visa Oro BOB" tiene cargos vigentes por 4.80 BOB y "Visa Oro USD" por 1.25 USD
Entonces el reporte de deudas suma 4.80 BOB y 1.25 USD de interés y cargos de tarjetas en 2026-10 y el tipo tarjetas del reporte de comisiones informa 4.80 BOB y 1.25 USD en 2026-10
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
- Se suma al PBT de reconciliación de los reportes ampliados, al dataset Demo y al nightly del Large Seed; PBT con timeout explícito.
