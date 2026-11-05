---
id: TC-REPORTING-REPORTS-030
title: "Cada reporte de 12 meses del Large Seed responde con p95 de 800 ms o menos"
spec: reporting/financial-reports
related_specs: []
requirement: "Rendimiento de los reportes con el dataset grande"
scenario: "Doce meses del dataset grande"
requirement_status: provisional
fr: ["FR-REPORTING-008"]
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
tags: ["perf", "nightly", "large-seed"]
error_code: null
preconditions:
  - "Large Seed v2 (97 374 transacciones en el workspace principal)"
  - "Rango fijo 2025-10-01 → 2026-09-30"
  - "12 presupuestos de 30 líneas creados por la prueba"
  - "Host en quietud según docs/23 §5.5"
input: {}
steps:
  - "Medir las filas report-* bloqueantes sin If-None-Match"
expected_result:
  - "p95 ≤ 800 ms en ingresos y gastos (MoM y YoY + móvil 12), gastos por categoría, presupuesto vs real, flujo de caja, historial de saldo y patrimonio"
  - "El worker arranca con los mismos consumidores (sin consumidores nuevos)"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-030 — Cada reporte de 12 meses del Large Seed responde con p95 de 800 ms o menos

## Intención

NFR-PERF-006, criterio de salida de Phase 7.

## Escenario

```gherkin
Dado el Large Seed
Cuando el nightly pide cada reporte de 12 meses
Entonces el p95 de cada uno es como máximo 800 ms
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
