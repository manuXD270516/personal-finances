---
id: TC-PLATFORM-PIPELINE-008
title: "El nightly mide la búsqueda de texto con el Large Seed y falla si su p95 supera 400 ms"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Nightly de rendimiento con el Large Seed"
scenario: "Búsqueda de texto con el Large Seed"
requirement_status: confirmed
fr: []
nfr: [NFR-PERF-002]
invariants: []
priority: medium
type: platform
level: performance
automation_status: automated
automated_tests:
  - apps/api/test/perf/nightly.perf.ts
  - apps/api/test/perf/perf-report.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["nightly", "perf", "large-seed", "search"]
error_code: null
preconditions:
  - "Large Seed cargado a escala 1 por los casos de uso (workspace principal con al menos 50 000 transacciones)"
  - "API en proceso con JWT locales, como el resto de nightly.perf.ts"
input:
  query: "q=super&limit=50"
  iterations: 200
  threshold_p95_ms: 400
steps:
  - "Calentar y ejecutar 200 veces GET W/transactions con q=super y limit=50"
  - "Registrar el p95 en el reporte con su umbral"
expected_result:
  - "El reporte del nightly incluye NFR-PERF-002 con el p95 medido y el umbral de 400 ms"
  - "La aserción final del nightly falla si el p95 supera 400 ms"
  - "El reporte se publica como artefacto aunque la corrida falle"
created: 2026-10-13
updated: 2026-10-16
---

# TC-PLATFORM-PIPELINE-008 — El nightly mide la búsqueda de texto con el Large Seed y falla si su p95 supera 400 ms

## Intención

docs/02 fija NFR-PERF-002 (búsqueda de texto en 50 000 transacciones, p95 ≤ 400 ms) con medición "Benchmark nightly", y el nightly existente no la mide. La búsqueda sin índice adecuado es el primer listado que se degrada al crecer el historial.

## Escenario

```gherkin
Dado el workspace principal del Large Seed con al menos 50 000 transacciones
Cuando el nightly busca "super" (descripción normalizada de las compras de supermercado) con 50 resultados por página
Entonces el reporte incluye el p95 de la búsqueda frente a 400 ms
  Y el nightly falla si el p95 supera 400 ms
```

## Notas

- El Large Seed no genera "supermercado": las compras de esa categoría se describen como "Súper" y `search_text` las guarda normalizadas ("super"). Por eso la consulta es `q=super` (tarea 4.1, 2026-10-16).
- Medición (tarea 4.2, 2026-10-28): escala 1 en los nightly programados de `main`, p95 de 31,47 ms (run 40498168581) y 43,39 ms (run 40186569273); local a escala 0,1, 33,21 ms. Todos bajo 400 ms.
- Bloqueante en el nightly según la pregunta 9 de design.md; el nightly no es check requerido.

- 2026-10-16: automatizado: benchmark `[TC-PLATFORM-PIPELINE-008]` en `apps/api/test/perf/nightly.perf.ts` y umbral en `perf-report.test.ts`. Sin Docker en la sesión de implementación no se midió el p95; pendiente la corrida de `nightly` por `workflow_dispatch` a escala 1 (tarea 4.2).
