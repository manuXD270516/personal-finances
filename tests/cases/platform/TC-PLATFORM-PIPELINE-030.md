---
id: TC-PLATFORM-PIPELINE-030
title: "Una adquisición de conexión que vence con el pool del worker en 34 de 34 da el veredicto conexiones, separado del drenado"
spec: platform/delivery-pipeline
related_specs: ["platform/event-delivery"]
requirement: "El benchmark del import mide dentro de su presupuesto de conexiones"
scenario: "Adquisición de conexión vencida durante el drenado"
requirement_status: confirmed
fr: []
nfr: [NFR-PERF-007, NFR-PERF-008]
invariants: []
priority: high
type: platform
level: unit
automation_status: automated
automated_tests:
  - "apps/api/test/perf/connection-budget.test.ts"
  - "apps/api/test/perf/perf-report.test.ts"
  - "apps/api/test/perf/imports.perf.ts"
status: automated
regression_suite: false
phase: 5
tags: ["nightly", "perf", "connections", "imports"]
error_code: null
preconditions:
  - "Muestras sintéticas del pool del worker durante el drenado del import"
input:
  pool: worker
  in_use: 34
  max: 34
  acquire_wait_ms: 2150
  connection_timeout_ms: 2000
steps:
  - "Evaluar el veredicto de la suite con la muestra del input y el error timeout exceeded when trying to connect"
expected_result:
  - "La suite falla con el veredicto conexiones indicando el pool del worker, 34 de 34 en uso y la espera de 2 150 ms"
  - "El reporte publica el pico de conexiones del servidor frente a su máximo, separado del resultado del drenado"
  - "El fallo no se reporta como drenado sobre el presupuesto"
created: 2026-10-27
updated: 2026-10-28
---

# TC-PLATFORM-PIPELINE-030 — Una adquisición de conexión que vence con el pool del worker en 34 de 34 da el veredicto conexiones, separado del drenado

## Intención

El síntoma de E10 se confundía con un drenado lento. El veredicto `conexiones` separa las dos manifestaciones y dice qué pool se llenó.

## Escenario

```gherkin
Dado el pool del worker con 34 de 34 conexiones en uso durante el drenado
Cuando una adquisición espera más de 2 000 ms
Entonces la suite falla con el veredicto conexiones, el pool, 34 de 34 y la espera
  Y el reporte separa ese fallo del resultado del drenado
```

## Notas

- Change `fix-imports-perf-connection-budget` (D299, [docs/52](../../../docs/52-perf-under-load-owner-decisions.md)). El presupuesto de 120 s (D112) y los demás umbrales de `imports.perf.ts` no cambian (TC-PLATFORM-PIPELINE-028).
- Datos ficticios generados por el benchmark; `FixedClock` en America/La_Paz.
- 2026-10-28 (change 48b, tareas 2.2 y 2.3): automatizado en `perf-report.test.ts` (veredicto `conexiones` con el pool del worker en 34 de 34 y 2 150 ms, aunque el drenado también exceda, sin mencionar el drenado) y en `connection-budget.test.ts` (`instrumentPool` mide la espera de `pool.connect` con callback y con promesa y registra la vencida con pool, uso y máximo; el muestreador publica pico en uso, pico en espera, espera máxima y pico del servidor por aplicación, con consultas en serie). En 23 corridas del job `perf` no venció ninguna adquisición (espera máxima 108 ms, 0 en espera, worker 18–27 de 52, servidor 30–40 de 100): el veredicto `conexiones` no se disparó.
