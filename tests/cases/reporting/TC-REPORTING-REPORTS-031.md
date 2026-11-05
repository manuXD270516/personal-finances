---
id: TC-REPORTING-REPORTS-031
title: "La primera página y una página profunda del drill-down más grande responden con p95 de 300 ms o menos"
spec: reporting/financial-reports
related_specs: []
requirement: "Rendimiento de los reportes con el dataset grande"
scenario: "Drill-down de la celda más grande"
requirement_status: provisional
fr: ["FR-REPORTING-010"]
nfr: ["NFR-PERF-006"]
invariants: []
priority: high
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["perf", "nightly", "drill-down"]
error_code: null
preconditions:
  - "Large Seed v2"
  - "Categoría con más porciones en 2025-10-01 → 2026-09-30"
input:
  limit: "50"
steps:
  - "Medir report-drill-down-first-page y report-drill-down-deep-page (página 20 por cursor)"
expected_result:
  - "p95 ≤ 300 ms en ambas"
  - "report-export-csv se informa (no bloquea)"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-031 — La primera página y una página profunda del drill-down más grande responden con p95 de 300 ms o menos

## Intención

NFR-PERF-006: drill-down ≤ 300 ms.

## Escenario

```gherkin
Dado la categoría con más porciones
Cuando el nightly abre la primera página del drill-down
Entonces el p95 es como máximo 300 ms
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
