---
id: TC-REPORTING-REPORTS-060
title: "El reporte de deudas informa el interés y los cargos cargados de la tarjeta"
spec: reporting/financial-reports
related_specs: ["debt/credit-cards"]
requirement: "Reporte de evolución de deudas"
scenario: "Tarjeta con intereses cargados"
requirement_status: confirmed
fr: ["FR-REPORTING-008","FR-DEBT-013"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/card-charges.api.test.ts
  - apps/web/src/ui/reports/extended-reports.test.tsx
  - packages/contexts/reporting/src/application/extended-reports.queries.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["reports","debts","card-charges"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; tarjeta \"Visa Oro\" bimoneda con \"Visa Oro BOB\" y \"Visa Oro USD\", cierre el día 25 y vencimiento el día 15"
  - "Datos del ciclo del 2026-09-26 al 2026-10-25 de \"Visa Oro BOB\" según el scenario «Ciclo de octubre de Visa Oro BOB» (saldo al cierre 1120.50 BOB) y una compra de 400.00 BOB el 2026-10-26"
  - "FixedClock en 2026-10-28T12:00 America/La_Paz salvo que el escenario diga otra fecha; datos ficticios"
input: {}
steps:
  - "\"Visa Oro BOB\" tiene el cargo vigente del 2026-10-25 de 4.00 BOB de interés y 0.80 BOB de seguro y ningún otro cargo en 2026-09 ni 2026-10"
expected_result:
  - "el reporte informa para \"Visa Oro BOB\" interés cargado 0.00 BOB y otros cargos 0.00 BOB en septiembre, e interés cargado 4.00 BOB y otros cargos 0.80 BOB en octubre"
  - "lo pagado de \"Visa Oro BOB\" no se informa en ningún mes"
created: 2026-11-25
updated: 2026-11-25
---
# TC-REPORTING-REPORTS-060 — El reporte de deudas informa el interés y los cargos cargados de la tarjeta

## Intención

Verifica el scenario "Tarjeta con intereses cargados" del requirement "Reporte de evolución de deudas" de `reporting/financial-reports` (FR-REPORTING-008, FR-DEBT-013).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando "Visa Oro BOB" tiene el cargo vigente del 2026-10-25 de 4.00 BOB de interés y 0.80 BOB de seguro y ningún otro cargo en 2026-09 ni 2026-10
Entonces el reporte informa para "Visa Oro BOB" interés cargado 0.00 BOB y otros cargos 0.00 BOB en septiembre, e interés cargado 4.00 BOB y otros cargos 0.80 BOB en octubre
Y lo pagado de "Visa Oro BOB" no se informa en ningún mes
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
