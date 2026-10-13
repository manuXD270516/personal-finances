---
id: TC-PLATFORM-PIPELINE-008
title: "El nightly mide la búsqueda de texto con el Large Seed y falla si su p95 supera 400 ms"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Nightly de rendimiento con el Large Seed"
scenario: "Búsqueda de texto con el Large Seed"
requirement_status: provisional
fr: []
nfr: [NFR-PERF-002]
invariants: []
priority: medium
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["nightly", "perf", "large-seed", "search"]
error_code: null
preconditions:
  - "Large Seed cargado a escala 1 por los casos de uso (workspace principal con al menos 50 000 transacciones)"
  - "API en proceso con JWT locales, como el resto de nightly.perf.ts"
input:
  query: "q=supermercado&limit=50"
  iterations: 200
  threshold_p95_ms: 400
steps:
  - "Calentar y ejecutar 200 veces GET W/transactions con q=supermercado y limit=50"
  - "Registrar el p95 en el reporte con su umbral"
expected_result:
  - "El reporte del nightly incluye NFR-PERF-002 con el p95 medido y el umbral de 400 ms"
  - "La aserción final del nightly falla si el p95 supera 400 ms"
  - "El reporte se publica como artefacto aunque la corrida falle"
created: 2026-10-13
updated: 2026-10-13
---

# TC-PLATFORM-PIPELINE-008 — El nightly mide la búsqueda de texto con el Large Seed y falla si su p95 supera 400 ms

## Intención

docs/02 fija NFR-PERF-002 (búsqueda de texto en 50 000 transacciones, p95 ≤ 400 ms) con medición "Benchmark nightly", y el nightly existente no la mide. La búsqueda sin índice adecuado es el primer listado que se degrada al crecer el historial.

## Escenario

```gherkin
Dado el workspace principal del Large Seed con al menos 50 000 transacciones
Cuando el nightly busca "supermercado" con 50 resultados por página
Entonces el reporte incluye el p95 de la búsqueda frente a 400 ms
  Y el nightly falla si el p95 supera 400 ms
```

## Notas

- Si el plan del Large Seed no genera el término, se usa otro frecuente y se actualiza este caso (tarea 4.1).
- Bloqueante en el nightly según la pregunta 9 de design.md; el nightly no es check requerido.
