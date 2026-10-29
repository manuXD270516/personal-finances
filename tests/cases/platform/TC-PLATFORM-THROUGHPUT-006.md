---
id: TC-PLATFORM-THROUGHPUT-006
title: "Un consumidor sin agrupación sigue recibiendo cada evento en su propia transacción"
spec: platform/event-delivery
related_specs: ["imports/import-pipeline"]
requirement: "Entrega agrupada para consumidores que recalculan estado"
scenario: "Consumidor que no declara agrupación"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-008", "NFR-REL-008"]
invariants: []
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/platform/src/events/consumers.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["event-delivery", "throughput", "D301"]
error_code: null
preconditions:
  - "Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor"
  - "Workspaces ficticios \"W1 Personal Demo\" y \"W2 Familia Demo\""
input: "Datos del scenario \"Consumidor que no declara agrupación\" del delta de optimize-consumer-throughput"
steps:
  - "un consumidor sin agrupación declarada tiene pendientes 10 eventos de \"W1 Personal Demo\""
expected_result:
  - "cada evento se procesa en su propia transacción con su registro de inbox, como antes de este cambio"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-006 — Un consumidor sin agrupación sigue recibiendo cada evento en su propia transacción

## Intención

Un consumidor DEBE (MUST) poder declarar que su efecto recalcula estado y no depende del orden de los eventos de agregados distintos dentro de un mismo lote; para ese consumidor, el sistema DEBE (MUST) entregar los eventos de un lote que pertenecen al mismo workspace en una sola transacción de base de datos que registre en el inbox todos los eventos aún no procesados e invoque el efecto una sola vez con ellos, con el aislamiento de ese workspace.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando un consumidor sin agrupación declarada tiene pendientes 10 eventos de "W1 Personal Demo"
Entonces cada evento se procesa en su propia transacción con su registro de inbox, como antes de este cambio
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
