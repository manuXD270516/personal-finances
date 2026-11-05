---
id: TC-REPORTING-REPORTS-053
title: "Cada reporte ampliado del Large Seed responde con p95 de 800 ms o menos en el nightly"
spec: reporting/financial-reports
related_specs: []
requirement: "Rendimiento de los reportes ampliados"
scenario: "Tendencias de 24 meses"
requirement_status: provisional
fr: ["FR-REPORTING-008"]
nfr: ["NFR-PERF-006"]
invariants: []
priority: medium
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["perf", "nightly", "large-seed"]
error_code: null
preconditions:
  - "Large Seed v2; 5 metas y 2 préstamos creados por la prueba"
  - "Rango fijo del núcleo (24 meses para tendencias)"
input: {}
steps:
  - "Medir las filas report-* ampliadas sin If-None-Match"
expected_result:
  - "p95 ≤ 800 ms en los nueve reportes"
  - "Sin consumidores nuevos en el worker"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-053 — Cada reporte ampliado del Large Seed responde con p95 de 800 ms o menos en el nightly

## Intención

NFR-PERF-006 para todo el catálogo de Phase 7.

## Escenario

```gherkin
Dado el Large Seed
Cuando el nightly pide las tendencias de 24 meses
Entonces el p95 es como máximo 800 ms
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.
