---
id: TC-PLATFORM-THROUGHPUT-008
title: "Con la configuración del host cada consumidor drena los eventos de 5 000 transacciones importadas en 120 s"
spec: platform/event-delivery
related_specs: ["imports/import-pipeline"]
requirement: "Ráfaga de un import grande con la configuración del host"
scenario: "Cinco mil transacciones importadas con concurrencia 1"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-007", "NFR-PERF-008", "NFR-REL-008"]
invariants: []
priority: high
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 6
tags: ["event-delivery", "throughput", "D301", "nightly", "perf"]
error_code: null
preconditions:
  - "Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor"
  - "Workspaces ficticios \"W1 Personal Demo\" y \"W2 Familia Demo\""
input: "Datos del scenario \"Cinco mil transacciones importadas con concurrencia 1\" del delta de optimize-consumer-throughput"
steps:
  - "se persisten 5 000 transacciones importadas con los consumidores detenidos, quedan pendientes a la vez sus 15 000 eventos y el worker arranca con concurrencia 1, pool de 34 y 4 conexiones reservadas"
expected_result:
  - "cada consumidor termina de procesar sus eventos en 120 segundos o menos desde ese arranque"
  - "el outbox queda sin eventos pendientes en ese plazo"
  - "ninguna adquisición de conexión vence"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-008 — Con la configuración del host cada consumidor drena los eventos de 5 000 transacciones importadas en 120 s

## Intención

Con la configuración de la plantilla del host —concurrencia 1 por consumidor, pool de 34 conexiones en el worker con 4 reservadas y pool de 22 en la API—, cada consumidor DEBE (MUST) terminar de procesar los eventos de las transacciones de un import de 5 000 filas en 120 segundos o menos desde que termina la persistencia, aunque todos esos eventos queden pendientes a la vez, y el outbox DEBE (MUST) quedar sin eventos pendientes en ese plazo.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando se persisten 5 000 transacciones importadas con los consumidores detenidos, quedan pendientes a la vez sus 15 000 eventos y el worker arranca con concurrencia 1, pool de 34 y 4 conexiones reservadas
Entonces cada consumidor termina de procesar sus eventos en 120 segundos o menos desde ese arranque
  Y el outbox queda sin eventos pendientes en ese plazo
  Y ninguna adquisición de conexión vence
```

## Notas

- Se automatiza al cerrar el change (tarea 6.3): la medición vive en `apps/api/test/perf/imports.perf.ts` (fila del host, bloqueante por D311) y `apps/api/test/perf/throughput.perf.ts`; pasa a `automated` con la evidencia de dos nightlies programados seguidos con la ráfaga ≤ 120 s por consumidor. Mediciones previas a la entrega agrupada en `docs/59-consumer-throughput-findings.md`.

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
