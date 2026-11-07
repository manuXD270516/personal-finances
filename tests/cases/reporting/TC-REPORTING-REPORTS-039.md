---
id: TC-REPORTING-REPORTS-039
title: "Gastos por etiqueta con coincidencia cualquiera o todas y aviso de no aditividad"
spec: reporting/financial-reports
related_specs: ["classification/tags"]
requirement: "Reporte de gastos por etiqueta"
scenario: "Viaje con un gasto compartido con trabajo"
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
  - packages/contexts/transactions/test/integration/pg-nominal-portions.int.test.ts
  - apps/api/test/api/financial-reports-extended.api.test.ts
  - apps/web/src/ui/reports/extended-reports.test.tsx
status: automated
regression_suite: true
phase: 7
tags: ["by-tag"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "2026-10: hotel 800.00 BOB con \"Viaje Cusco\" y \"Trabajo\"; comida 200.00 BOB con \"Viaje Cusco\""
input:
  tagMatch: "ANY | ALL"
steps:
  - "Calcular el reporte con coincidencia cualquiera"
  - "Calcular con coincidencia todas"
expected_result:
  - "\"Viaje Cusco\" 1000.00 BOB y \"Trabajo\" 800.00 BOB con nonAdditive = true"
  - "Con todas: 800.00 BOB"
  - "Nunca se presenta 1800.00 BOB como gasto total"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-039 — Gastos por etiqueta con coincidencia cualquiera o todas y aviso de no aditividad

## Intención

docs/14 §3: los totales de etiquetas no se suman.

## Escenario

```gherkin
Dado un hotel con dos etiquetas y una comida con una
Cuando se pide gastos por etiqueta de 2026-10
Entonces "Viaje Cusco" informa 1000.00 BOB y "Trabajo" 800.00 BOB con aviso de no aditividad
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.
