---
id: TC-PLATFORM-THROUGHPUT-015
title: "Una fila del host por encima de 120 s se publica como informativa y no decide el veredicto"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "El benchmark del import mide también con la configuración del host"
scenario: "Fila del host por encima de 120 segundos"
requirement_status: provisional
fr: []
nfr: ["NFR-PERF-007", "NFR-PERF-008"]
invariants: []
priority: medium
type: platform
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["event-delivery", "throughput", "D301", "nightly", "perf", "D307"]
error_code: null
preconditions:
  - "Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor"
  - "Workspaces ficticios \"W1 Personal Demo\" y \"W2 Familia Demo\""
input: "Datos del scenario \"Fila del host por encima de 120 segundos\" del delta de optimize-consumer-throughput"
steps:
  - "con la configuración del host un consumidor tarda 130 segundos en drenar y con la del código todos drenan en 40 segundos"
expected_result:
  - "la fila del host se publica como informativa excedida, con el consumidor y su tiempo"
  - "el veredicto del job lo decide la fila de la configuración del código"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-015 — Una fila del host por encima de 120 s se publica como informativa y no decide el veredicto

## Intención

El benchmark nocturno del import de 5 000 filas DEBERÍA (SHOULD) medir, además de la configuración por omisión del código, la configuración de la plantilla del host (concurrencia 1 por consumidor, pool de 34 en el worker y de 22 en la API), con la misma precondición de presupuesto de conexiones y el mismo drenado por consumidor; el reporte DEBE (MUST) mostrar ambas configuraciones por separado y la de la plantilla del host DEBE (MUST) quedar informativa mientras el owner no decida que sea bloqueante.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando con la configuración del host un consumidor tarda 130 segundos en drenar y con la del código todos drenan en 40 segundos
Entonces la fila del host se publica como informativa excedida, con el consumidor y su tiempo
  Y el veredicto del job lo decide la fila de la configuración del código
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
