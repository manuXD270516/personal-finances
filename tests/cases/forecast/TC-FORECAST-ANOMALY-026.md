---
id: TC-FORECAST-ANOMALY-026
title: "La pasada diaria tarda como máximo 10 s con el workspace principal del Large Seed"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Rendimiento y métricas de la detección"
scenario: "Workspace grande"
requirement_status: confirmed
fr: ["FR-FORECAST-010"]
nfr: ["NFR-PERF-012","NFR-OBS-004"]
invariants: []
priority: medium
type: platform
level: performance
automation_status: automated
automated_tests:
  - apps/api/test/perf/anomalies.perf.ts
  - apps/api/test/perf/suite-order.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["anomalies","perf"]
error_code: null
preconditions:
  - "Workspace principal del Large Seed cargado (97 374 transacciones) con la detección habilitada"
  - "Benchmark del nightly con timeout explícito"
input: {}
steps:
  - "el trabajo diario evalúa el workspace principal con 7 días de gastos nuevos"
expected_result:
  - "la pasada de ese workspace tarda como máximo 10 s"
  - "las métricas registran los gastos evaluados y marcados sin montos ni ids en las etiquetas"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-026 — La pasada diaria tarda como máximo 10 s con el workspace principal del Large Seed

## Intención

Verifica el scenario "Workspace grande" del requirement "Rendimiento y métricas de la detección" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace principal del Large Seed cargado (97 374 transacciones) con la detección habilitada
Cuando el trabajo diario evalúa el workspace principal con 7 días de gastos nuevos
Entonces la pasada de ese workspace tarda como máximo 10 s
Y las métricas registran los gastos evaluados y marcados sin montos ni ids en las etiquetas
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
