---
id: TC-PLATFORM-THROUGHPUT-010
title: "La ráfaga agrupada con reentregas deja exactamente 12 sugerencias de coincidencia"
spec: platform/event-delivery
related_specs: ["commitments/recurrence-engine"]
requirement: "Ráfaga de un import grande con la configuración del host"
scenario: "Sin sugerencias duplicadas en la ráfaga"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-007", "NFR-PERF-008", "NFR-REL-008"]
invariants: ["INV-028"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/matching.service.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["event-delivery", "throughput", "D301"]
error_code: null
preconditions:
  - "Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor"
  - "Workspaces ficticios \"W1 Personal Demo\" y \"W2 Familia Demo\""
input: "Datos del scenario \"Sin sugerencias duplicadas en la ráfaga\" del delta de optimize-consumer-throughput"
steps:
  - "entre las 5 000 transacciones importadas hay 12 compatibles con ocurrencias pendientes y algunos de sus eventos se entregan dos veces"
expected_result:
  - "existen exactamente 12 sugerencias de coincidencia propuestas"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-010 — La ráfaga agrupada con reentregas deja exactamente 12 sugerencias de coincidencia

## Intención

Con la configuración de la plantilla del host —concurrencia 1 por consumidor, pool de 34 conexiones en el worker con 4 reservadas y pool de 22 en la API—, cada consumidor DEBE (MUST) terminar de procesar los eventos de las transacciones de un import de 5 000 filas en 120 segundos o menos desde que termina la persistencia, aunque todos esos eventos queden pendientes a la vez, y el outbox DEBE (MUST) quedar sin eventos pendientes en ese plazo.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando entre las 5 000 transacciones importadas hay 12 compatibles con ocurrencias pendientes y algunos de sus eventos se entregan dos veces
Entonces existen exactamente 12 sugerencias de coincidencia propuestas
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
