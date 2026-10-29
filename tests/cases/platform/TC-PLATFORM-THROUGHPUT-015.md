---
id: TC-PLATFORM-THROUGHPUT-015
title: "Una fila del host por encima de 120 s se publica como bloqueante fallida y decide el veredicto; la del código solo informa"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "El benchmark del import mide también con la configuración del host"
scenario: "Fila del host por encima de 120 segundos"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-007", "NFR-PERF-008"]
invariants: []
priority: medium
type: platform
level: unit
automation_status: automated
automated_tests:
  - apps/api/test/perf/perf-report.test.ts
status: automated
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
  - "la fila del host se publica como bloqueante fallida, con el consumidor y su tiempo"
  - "el veredicto del job lo decide la fila de la configuración del host (D311); una fila del código excedida se publica como informativa y no lo cambia"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-015 — Una fila del host por encima de 120 s se publica como bloqueante fallida y decide el veredicto; la del código solo informa

## Intención

El benchmark nocturno del import de 5 000 filas DEBE (MUST) medir, además de la configuración por omisión del código, la configuración de la plantilla del host; por D311 la fila del host es bloqueante y la del código informativa.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando con la configuración del host un consumidor tarda 130 segundos en drenar y con la del código todos drenan en 40 segundos
Entonces la fila del host se publica como bloqueante fallida, con el consumidor y su tiempo
  Y el veredicto del job lo decide la fila de la configuración del host
  Y una fila del código excedida se publica como informativa y no cambia el veredicto
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
