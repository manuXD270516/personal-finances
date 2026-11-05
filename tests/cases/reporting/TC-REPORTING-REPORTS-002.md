---
id: TC-REPORTING-REPORTS-002
title: "Los filtros por cuenta y por categoría con subcategorías se aplican a las cifras del reporte"
spec: reporting/financial-reports
related_specs: []
requirement: "Filtros comunes de los reportes"
scenario: "Filtro por cuenta"
requirement_status: confirmed
fr: ["FR-REPORTING-008", "FR-REPORTING-010"]
nfr: []
invariants: []
priority: high
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/financial-reports.queries.test.ts
  - packages/contexts/transactions/test/integration/pg-nominal-portions.int.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["filters"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "En 2026-10: 3300.00 BOB de gasto desde \"Banco BOB\" y 500.00 BOB con \"Tarjeta Andina\""
  - "\"Supermercado\" con 2300.00 BOB propios y su subcategoría \"Mayorista\" con 1000.00 BOB"
input:
  accountId: "Tarjeta Andina"
  categoryId: "Supermercado"
steps:
  - "Pedir ingresos y gastos de 2026-10 filtrado por \"Tarjeta Andina\""
  - "Pedir ingresos y gastos de 2026-10 filtrado por \"Supermercado\""
  - "Pedir el reporte con un categoryId de otro workspace"
expected_result:
  - "Gasto de 2026-10 = 500.00 BOB con el filtro por cuenta"
  - "Gasto de 2026-10 = 3300.00 BOB con el filtro por categoría (incluye la subcategoría)"
  - "El id de otro workspace no coincide con nada y no revela su existencia"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-002 — Los filtros por cuenta y por categoría con subcategorías se aplican a las cifras del reporte

## Intención

Los filtros comunes son la base de la coherencia entre reporte, comparación y drill-down.

## Escenario

```gherkin
Dado gastos desde "Banco BOB" y "Tarjeta Andina" en 2026-10
Cuando se filtra por "Tarjeta Andina"
Entonces el gasto de 2026-10 es 500.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
