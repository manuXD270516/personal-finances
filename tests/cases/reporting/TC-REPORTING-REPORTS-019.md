---
id: TC-REPORTING-REPORTS-019
title: "El drill-down respeta los filtros del reporte y pagina por cursor sin repetidos con los mismos totales"
spec: reporting/financial-reports
related_specs: []
requirement: "Drill-down con los mismos filtros y paginado"
scenario: "Ciento veinte porciones"
requirement_status: provisional
fr: ["FR-REPORTING-010"]
nfr: ["NFR-PERF-006"]
invariants: []
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["drill-down", "pagination"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Una celda con 120 porciones"
  - "Reporte de 2026-10 filtrado por \"Tarjeta Andina\" con 500.00 BOB de gasto"
input:
  limit: "50"
steps:
  - "Recorrer la celda con páginas de 50"
  - "Abrir el drill-down del gasto filtrado por \"Tarjeta Andina\""
expected_result:
  - "Páginas de 50, 50 y 20 filas, sin repetidos ni faltantes, orden fecha desc e id"
  - "Las tres páginas informan los mismos totales"
  - "Con el filtro, todas las filas son de \"Tarjeta Andina\" y suman 500.00 BOB"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-019 — El drill-down respeta los filtros del reporte y pagina por cursor sin repetidos con los mismos totales

## Intención

La paginación por cursor no debe perder ni duplicar filas aunque se registren datos entre páginas.

## Escenario

```gherkin
Dado una celda con 120 porciones
Cuando se piden páginas de 50
Entonces se obtienen 50, 50 y 20 filas sin repetidos y con los mismos totales
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
