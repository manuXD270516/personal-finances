---
id: TC-PLATFORM-THROUGHPUT-009
title: "El worker de la plantilla del host arranca con 32 de 34 conexiones y sin consumidores nuevos"
spec: platform/event-delivery
related_specs: ["imports/import-pipeline"]
requirement: "Ráfaga de un import grande con la configuración del host"
scenario: "El worker de la plantilla arranca sin conexiones nuevas"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-007", "NFR-PERF-008", "NFR-REL-008"]
invariants: []
priority: high
type: unit
level: unit
automation_status: automated
automated_tests:
  - apps/api/test/events/event-throughput.int.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["event-delivery", "throughput", "D301", "connections", "D249"]
error_code: null
preconditions:
  - "Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor"
  - "Workspaces ficticios \"W1 Personal Demo\" y \"W2 Familia Demo\""
input: "Datos del scenario \"El worker de la plantilla arranca sin conexiones nuevas\" del delta de optimize-consumer-throughput"
steps:
  - "el worker arranca con la configuración de la plantilla del host y los 28 consumidores con concurrencia 1"
expected_result:
  - "el arranque valida 28 conexiones de consumidores más 4 reservadas, 32 de 34"
  - "la cantidad de consumidores y su concurrencia sumada son las mismas que antes de este cambio"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-009 — El worker de la plantilla del host arranca con 32 de 34 conexiones y sin consumidores nuevos

## Intención

Con la configuración de la plantilla del host —concurrencia 1 por consumidor, pool de 34 conexiones en el worker con 4 reservadas y pool de 22 en la API—, cada consumidor DEBE (MUST) terminar de procesar los eventos de las transacciones de un import de 5 000 filas en 120 segundos o menos desde que termina la persistencia, aunque todos esos eventos queden pendientes a la vez, y el outbox DEBE (MUST) quedar sin eventos pendientes en ese plazo.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando el worker arranca con la configuración de la plantilla del host y los 28 consumidores con concurrencia 1
Entonces el arranque valida 28 conexiones de consumidores más 4 reservadas, 32 de 34
  Y la cantidad de consumidores y su concurrencia sumada son las mismas que antes de este cambio
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
