---
id: TC-REPORTING-REPORTS-040
title: "Gastos por cuenta con tipo e institución y suma igual al gasto total"
spec: reporting/financial-reports
related_specs: []
requirement: "Reporte de gastos por cuenta"
scenario: "Banco y tarjeta en octubre"
requirement_status: confirmed
fr: ["FR-REPORTING-008"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/domain/extended-reports.domain.test.ts
  - packages/contexts/reporting/src/application/extended-reports.queries.test.ts
  - packages/contexts/reporting/src/application/financial-reports.exports.test.ts
  - apps/api/test/api/financial-reports-extended.api.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["by-account"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "2026-10: 3300.00 BOB desde \"Banco BOB\" en \"Supermercado\"; 500.00 BOB con \"Tarjeta Andina\" en \"Restaurantes\""
input: {}
steps:
  - "Calcular gastos por cuenta de 2026-10"
expected_result:
  - "\"Banco BOB\" 3300.00 BOB; \"Tarjeta Andina\" 500.00 BOB (tarjeta de crédito)"
  - "Σ cuentas = 3800.00 BOB = gasto total"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-040 — Gastos por cuenta con tipo e institución y suma igual al gasto total

## Intención

Reporte 5: "¿desde qué cuentas gasto?" sin perder ni duplicar gasto.

## Escenario

```gherkin
Dado gastos desde "Banco BOB" y "Tarjeta Andina"
Cuando se pide gastos por cuenta de 2026-10
Entonces las cuentas suman el gasto total de 3800.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.
