---
id: TC-PLATFORM-PIPELINE-028
title: "El test de política rechaza relajar el umbral de un benchmark sin decisión del owner"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Causa de los rojos de rendimiento documentada antes de cambiar un umbral"
scenario: "Se intenta relajar un umbral sin decisión del owner"
requirement_status: confirmed
fr: []
nfr: [NFR-PERF-004, NFR-PERF-008, NFR-MAINT-005]
invariants: []
priority: medium
type: platform
level: smoke
automation_status: automated
automated_tests:
  - scripts/delivery-policy/test/nightly-policy.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["nightly", "perf", "policy", "thresholds"]
error_code: null
preconditions:
  - "Umbrales de los benchmarks en perf-report.ts y en las suites, iguales a docs/02 §PERF"
input:
  - fixture: "p95 de disponible para gastar 300 → 400 ms"
    expected: "falla indicando el benchmark, 400 ms y 300 ms de docs/02"
  - fixture: "throughput mínimo por consumidor 42 → 5 ev/s"
    expected: "falla indicando el benchmark, 5 ev/s y 42 ev/s de docs/02"
steps:
  - "Evaluar la regla sobre los umbrales reales"
  - "Evaluar la regla sobre cada fixture"
expected_result:
  - "Con los umbrales reales la regla pasa y las filas bloqueantes siguen siéndolo"
  - "Cada fixture hace fallar la regla con el benchmark, el umbral nuevo y el de docs/02"
created: 2026-10-21
updated: 2026-10-23
---

# TC-PLATFORM-PIPELINE-028 — El test de política rechaza relajar el umbral de un benchmark sin decisión del owner

## Intención

La salida fácil de un rojo de rendimiento es subir el umbral. El test de política obliga a que ese cambio venga con una decisión del owner registrada y citada.

## Escenario

```gherkin
Dados los umbrales de los benchmarks iguales a docs/02
Cuando una pull request sube el p95 de disponible para gastar de 300 ms a 400 ms sin decisión del owner
Entonces el test de política falla indicando el benchmark y ambos umbrales
```

## Notas

- Change `investigate-perf-under-load` (D290), tarea 6.1. Cambiar un umbral exige editar la tabla esperada del test con la D-id que lo aprueba.
- Implementado el 2026-10-23 (tarea 6.1): `scripts/delivery-policy/test/nightly-policy.test.ts` compara `PERF_THRESHOLDS`, `PERF_THROUGHPUT` y las constantes locales de las suites (`BUDGET_MS`, `COST_P95_MS`, `GOAL_EVENTS_PER_SECOND`, `PREVIEW_BUDGET_MS`, `PERSIST_BUDGET_MS`, `DRAIN_BUDGET_MS`) con la tabla esperada, que a su vez se verifica contra la fila de cada NFR de docs/02. `BUDGET_MS` de `spendable.perf.ts` y `GOAL_EVENTS_PER_SECOND` de `commitments.perf.ts` ahora salen de `perf-report.ts` (mismos valores: 300 ms y 42 ev/s). Las filas bloqueantes de `nightly.perf.ts` siguen siéndolo y la de throughput por consumidor, informativa (D43, D292). Con los fixtures 300 → 400 ms y 42 → 5 ev/s la regla falla con el benchmark y ambos valores.
