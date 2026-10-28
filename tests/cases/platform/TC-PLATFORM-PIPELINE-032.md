---
id: TC-PLATFORM-PIPELINE-032
title: "Un drenado de 123,5 s frente a 120 s falla nombrando los consumidores que superaron el presupuesto"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "El drenado del benchmark del import se publica por consumidor"
scenario: "Drenado marginal sobre el presupuesto"
requirement_status: confirmed
fr: []
nfr: [NFR-PERF-008]
invariants: []
priority: medium
type: platform
level: unit
automation_status: automated
automated_tests:
  - "apps/api/test/perf/perf-report.test.ts"
  - "apps/api/test/perf/imports.perf.ts"
status: automated
regression_suite: false
phase: 5
tags: ["nightly", "perf", "drain", "imports"]
error_code: null
preconditions:
  - "Resultado sintético del drenado del import con el tiempo del nightly programado 40322158874 (2026-10-26)"
input:
  drained_after_persist_ms: 123458.95
  drain_budget_ms: 120000
steps:
  - "Evaluar el resultado de la suite con el drenado del input y el detalle por consumidor"
expected_result:
  - "La suite falla indicando 123,5 s frente a 120 s"
  - "El mensaje nombra los consumidores que terminaron después de 120 s con su tiempo"
  - "El veredicto es de drenado y no de conexiones"
created: 2026-10-27
updated: 2026-10-28
---

# TC-PLATFORM-PIPELINE-032 — Un drenado de 123,5 s frente a 120 s falla nombrando los consumidores que superaron el presupuesto

## Intención

Segunda manifestación del rojo de `imports.perf` (programado 40322158874): el fallo actual solo dice `expected 123458.95 to be less than or equal to 120000`. Sin saber qué consumidor lo marca no se puede elegir el arreglo.

## Escenario

```gherkin
Dado un drenado que termina 123,5 s después de la persistencia
Cuando se evalúa frente al presupuesto de 120 s
Entonces la suite falla con 123,5 s frente a 120 s y los consumidores que lo superaron
  Y el veredicto es de drenado
```

## Notas

- Change `fix-imports-perf-connection-budget` (D299, [docs/52](../../../docs/52-perf-under-load-owner-decisions.md)). El presupuesto de 120 s (D112) y los demás umbrales de `imports.perf.ts` no cambian (TC-PLATFORM-PIPELINE-028).
- Datos ficticios generados por el benchmark; `FixedClock` en America/La_Paz.
- 2026-10-28 (change 48b, tarea 2.2): automatizado en `perf-report.test.ts`: un drenado de 123 458,95 ms frente a 120 000 ms da el veredicto `drenado`, con «123,5 s frente a 120 s» y los consumidores que terminaron después, sin mencionar conexiones; una cola que no llegó a 0 se nombra como tal; 120 s exactos pasan. `imports.perf.ts` lanza ese mensaje (`expect(drainAfterPersistMs, verdict.message)`). El valor de 123,5 s del programado 40322158874 no se reprodujo en 23 corridas (1,3–35,8 s): [docs/54](../../../docs/54-imports-perf-questions.md), pregunta 1.
