---
id: TC-REPORTING-REPORTS-007
title: "Presupuesto vs real por periodos reutiliza las cifras de planificación y marca los periodos sin presupuesto"
spec: reporting/financial-reports
related_specs: ["planning/budgets"]
requirement: "Reporte de presupuesto vs real por periodos"
scenario: "Septiembre con presupuesto y octubre sin presupuesto"
requirement_status: confirmed
fr: ["FR-REPORTING-008", "FR-PLANNING-024"]
nfr: []
invariants: ["INV-034"]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/financial-reports.api.test.ts
  - packages/contexts/reporting/src/application/financial-reports.queries.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["budget-vs-actual"]
error_code: "VALIDATION_FAILED"
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Periodo 2026-09 con la línea \"Supermercado\" de máximo 3000.00 BOB y real 3200.00 BOB"
  - "Periodo 2026-10 sin presupuesto"
input:
  from: "2026-09-01"
  to: "2026-10-31"
steps:
  - "GET W/reports/budget-vs-actual del rango"
  - "Repetir con grouping=CALENDAR_MONTH"
expected_result:
  - "2026-09: \"Supermercado\" referencia 3000.00 BOB, real 3200.00 BOB, estado excedido (igual a GET W/budgets/{id})"
  - "2026-10: NO_BUDGET sin referencias en cero"
  - "grouping=CALENDAR_MONTH ⇒ 400 VALIDATION_FAILED"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-007 — Presupuesto vs real por periodos reutiliza las cifras de planificación y marca los periodos sin presupuesto

## Intención

Una sola fuente de verdad del presupuesto vs real: Reporting no recalcula lo que calcula Planning.

## Escenario

```gherkin
Dado un presupuesto en 2026-09 y ninguno en 2026-10
Cuando se pide presupuesto vs real de 2026-09 a 2026-10
Entonces 2026-09 informa la línea con estado excedido
  Y 2026-10 se informa "Sin presupuesto"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
