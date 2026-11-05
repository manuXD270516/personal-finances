---
id: TC-REPORTING-REPORTS-006
title: "Gastos por categoría con grupo, top N con \"Otras categorías\" y neto negativo visible"
spec: reporting/financial-reports
related_specs: []
requirement: "Reporte de gastos por categoría"
scenario: "Grupo Alimentación en octubre"
requirement_status: confirmed
fr: ["FR-REPORTING-008"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/financial-reports.api.test.ts
  - packages/contexts/reporting/src/application/financial-reports.queries.test.ts
  - packages/contexts/reporting/src/domain/reports.domain.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["by-category"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "2026-10: \"Supermercado\" 3300.00 BOB y \"Restaurantes\" 500.00 BOB (grupo \"Alimentación\")"
  - "\"Electrónica\": gasto 100.00 BOB y reembolso 300.00 BOB"
  - "Una categoría archivada con gastos en 2026-10"
input:
  topN: "1"
steps:
  - "Calcular gastos por categoría de 2026-10"
  - "Calcular con topN = 1"
expected_result:
  - "\"Alimentación\" 3800.00 BOB = \"Supermercado\" 3300.00 + \"Restaurantes\" 500.00"
  - "Con top 1: \"Supermercado\" 3300.00 BOB y \"Otras categorías\" 500.00 BOB"
  - "\"Electrónica\" −200.00 BOB marcado como neto negativo"
  - "La categoría archivada aparece con sus movimientos"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-006 — Gastos por categoría con grupo, top N con "Otras categorías" y neto negativo visible

## Intención

Reporte Must 3: "¿en qué gasto?" sin ocultar netos negativos ni categorías archivadas.

## Escenario

```gherkin
Dado "Supermercado" 3300.00 BOB y "Restaurantes" 500.00 BOB en "Alimentación"
Cuando se pide gastos por categoría de 2026-10
Entonces "Alimentación" informa 3800.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
