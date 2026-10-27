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
automation_status: not_automated
automated_tests: []
status: draft
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
updated: 2026-10-27
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
