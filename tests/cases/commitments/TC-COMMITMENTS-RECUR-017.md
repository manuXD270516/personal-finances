---
id: TC-COMMITMENTS-RECUR-017
title: 'Sesenta definiciones con horizonte de 90 días se generan en 10 segundos o menos'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Rendimiento de la generación'
scenario: 'Sesenta definiciones'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-006']
nfr: ['NFR-PERF-009']
invariants: []
priority: medium
type: integration
level: performance
automation_status: automated
automated_tests:
  - apps/api/test/perf/commitments.perf.ts
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'performance']
error_code: null
preconditions:
  - 'Workspace con 20 diarias, 20 semanales y 20 mensuales sin ocurrencias'
  - 'Stack de CI (Postgres en contenedor)'
input:
  horizon: '90'
steps:
  - 'Ejecutar GenerateOccurrences(workspace) y medir'
expected_result:
  - 'Duración ≤ 10 s'
  - 'Ocurrencias totales = 20×91 + 20×13 + 20×3 aprox. según fechas'
  - 'Métrica commitments_generation_duration_seconds registrada'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-017 — Sesenta definiciones con horizonte de 90 días se generan en 10 segundos o menos

## Intención

NFR-PERF-009 (Should).

## Escenario

```gherkin
Dado 60 definiciones activas sin ocurrencias
Cuando se generan 90 días
Entonces termina en 10 s o menos
```

## Notas

- Suite perf nightly; no bloquea PR.
