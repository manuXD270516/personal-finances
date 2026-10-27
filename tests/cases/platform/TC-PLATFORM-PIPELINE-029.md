---
id: TC-PLATFORM-PIPELINE-029
title: "La suite del import falla antes de medir si la suma de sus pools (115) no cabe en las 97 conexiones disponibles del servidor"
spec: platform/delivery-pipeline
related_specs: ["platform/event-delivery"]
requirement: "El benchmark del import mide dentro de su presupuesto de conexiones"
scenario: "Presupuesto del benchmark que no cabe en el servidor"
requirement_status: confirmed
fr: []
nfr: [NFR-PERF-007, NFR-PERF-008]
invariants: []
priority: high
type: platform
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["nightly", "perf", "connections", "imports"]
error_code: null
preconditions:
  - "Suite imports.perf.ts con la API y el worker en el mismo proceso"
  - "Pools máximos por omisión: API 52, worker 52, una cola de trabajos de 4 por proceso y 3 del harness"
input:
  pools: {api: 52, worker: 52, api_queue: 4, worker_queue: 4, harness: 3}
  max_connections: 100
  superuser_reserved_connections: 3
steps:
  - "Test unitario de la precondición de presupuesto con los pools y el límite del input"
  - "Repetir con una suma que cabe en el límite"
expected_result:
  - "Con 115 frente a 97 la suite falla antes de subir el archivo, indicando la suma, el límite y el tamaño de cada pool"
  - "No se publica ninguna medición del import como válida"
  - "Con una suma que cabe, la precondición pasa y la suite mide"
created: 2026-10-27
updated: 2026-10-27
---

# TC-PLATFORM-PIPELINE-029 — La suite del import falla antes de medir si la suma de sus pools (115) no cabe en las 97 conexiones disponibles del servidor

## Intención

Primera manifestación del rojo de `imports.perf` (`timeout exceeded when trying to connect`, E10): si la suma de los pools que abre el benchmark no cabe en el servidor, el resultado no dice nada del producto. La suite lo detecta antes de medir.

## Escenario

```gherkin
Dado un benchmark del import con pools que suman 115 conexiones
Cuando el servidor admite 100 con 3 reservadas
Entonces la suite falla antes de subir el archivo indicando 115 frente a 97
  Y no publica ninguna medición como válida
```

## Notas

- Change `fix-imports-perf-connection-budget` (D299, [docs/52](../../../docs/52-perf-under-load-owner-decisions.md)). El presupuesto de 120 s (D112) y los demás umbrales de `imports.perf.ts` no cambian (TC-PLATFORM-PIPELINE-028).
- Datos ficticios generados por el benchmark; `FixedClock` en America/La_Paz.
