---
id: TC-REPORTING-REPORTS-056
title: "Tendencias de 24 meses con p95 ≤ 800 ms en el nightly y objetivo interno ≤ 400 ms en un runner AMD"
spec: reporting/financial-reports
related_specs: ["fx/market-rates"]
requirement: "Rendimiento de los reportes ampliados"
scenario: "Tendencias de 24 meses"
requirement_status: confirmed
fr: ["FR-REPORTING-008"]
nfr: ["NFR-PERF-006"]
invariants: []
priority: high
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 7
tags: ["perf", "nightly", "large-seed", "trends", "fix-trends-report-perf"]
error_code: null
preconditions:
  - "Large Seed v2 a escala 1 (Testcontainers, PostgreSQL 18.6, `VACUUM (ANALYZE)` previo), como el job `perf`"
  - "Fila `report-trends-24m` de `apps/api/test/perf/nightly.perf.ts` sin cambios de ruta, rango (2024-10-01 → 2026-09-30), iteraciones ni umbral (D448)"
input:
  path: "trends?from=2024-10-01&to=2026-09-30&grouping=CALENDAR_MONTH"
steps:
  - "Corrida local a escala 1 con el diagnóstico por fase del design (§Medición), antes y después del cambio, en la misma máquina"
  - "Nightlies programados posteriores a la fusión: leer la fila `report-trends-24m` y la CPU del runner en `perf-report/perf-results.json` del artefacto"
expected_result:
  - "Local, misma máquina: p95 HTTP de tendencias 24 meses ≤ 50 % del medido antes del cambio, y fases `resolveRates` ≤ 20 ms y `trendMatrix` ≤ 40 ms (p50)"
  - "La fila `report-trends-24m` sigue bloqueante con p95 ≤ 800 ms en todos los nightlies"
  - "Objetivo interno de cierre (no es un umbral del nightly): p95 ≤ 400 ms en al menos un nightly programado sobre un runner AMD EPYC, y ≤ 400 ms en todos los nightlies programados de los 7 días siguientes a la fusión, cualquiera sea la CPU"
  - "Las demás filas `report-*` y `reports-summary` no empeoran más de un 10 % frente a la mediana de los nightlies previos con el mismo modelo de CPU"
created: 2026-11-23
updated: 2026-11-23
---

# TC-REPORTING-REPORTS-056 — Tendencias de 24 meses bajo el umbral con margen

## Intención

D448: optimizar sin tocar el umbral de 800 ms de NFR-PERF-006. La fila `report-trends-24m` midió 845 ms (AMD EPYC 7763), 772 ms (AMD EPYC 9V74) y 493–514 ms (Intel Xeon 6975P-C). El objetivo interno de 400 ms deja un margen de 2× sobre el umbral en el runner más lento observado.

## Escenario

```gherkin
Dado el Large Seed a escala 1 en el nightly
Cuando se piden las tendencias mensuales de los 24 meses completos más recientes
Entonces el p95 es como máximo 800 ms
Y en un runner AMD EPYC el p95 es como máximo 400 ms (objetivo interno del change)
```

## Notas

- El objetivo de 400 ms es criterio de cierre de `fix-trends-report-perf` (tarea 6.3), no un umbral nuevo del nightly: la fila conserva su límite de 800 ms (D448).
- Las guardas sin tiempo (TC-REPORTING-REPORTS-057 y TC-FX-RATE-010) viven en `unit` porque un tiempo medido en CI depende de la CPU del runner, que es justamente lo que hace variar esta fila.
- Change `fix-trends-report-perf`.
