---
id: TC-RULES-ENGINE-051
title: "Aplicar reglas en la creación manual suma 20 ms o menos al p95"
spec: rules/rule-engine
related_specs: []
requirement: "Límites y rendimiento de la evaluación"
scenario: null
requirement_status: confirmed
fr: ["FR-RULES-009"]
nfr: ["NFR-PERF-003"]
invariants: []
priority: high
type: platform
level: performance
automation_status: automated
automated_tests:
  - apps/api/test/perf/rules.perf.ts
  - packages/contexts/rules/src/application/performance.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "perf"]
error_code: null
preconditions:
  - "Dataset large"
  - "200 reglas activas con disparador MANUAL_CREATE"
input: {"rules":200}
steps:
  - "Benchmark nightly de creación de gastos con y sin applyRules"
expected_result:
  - "Diferencia de p95 ≤ 20 ms"
  - "p95 total ≤ 150 ms (NFR-PERF-003)"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-051 — Aplicar reglas en la creación manual suma 20 ms o menos al p95

## Intención

La evaluación síncrona no degrada el registro.

## Escenario

```gherkin
Dadas 200 reglas de creación manual
Cuando mido el registro con y sin reglas
Entonces la diferencia de p95 es de 20 ms o menos
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
