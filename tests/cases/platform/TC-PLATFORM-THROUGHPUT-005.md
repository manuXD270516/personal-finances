---
id: TC-PLATFORM-THROUGHPUT-005
title: "Con lotes de 100 el consumidor agrupado observa las versiones de un agregado en orden"
spec: platform/event-delivery
related_specs: ["imports/import-pipeline"]
requirement: "Entrega agrupada para consumidores que recalculan estado"
scenario: "Orden por agregado con lotes grandes"
requirement_status: provisional
fr: []
nfr: ["NFR-PERF-008", "NFR-REL-008"]
invariants: []
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["event-delivery", "throughput", "D301"]
error_code: null
preconditions:
  - "Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor"
  - "Workspaces ficticios \"W1 Personal Demo\" y \"W2 Familia Demo\""
input: "Datos del scenario \"Orden por agregado con lotes grandes\" del delta de optimize-consumer-throughput"
steps:
  - "un agregado tiene pendientes sus versiones 1 a 10 y el consumidor agrupado toma lotes de 100"
expected_result:
  - "cada lote trae a lo sumo una versión de ese agregado"
  - "el consumidor observa las versiones 1 a 10 en orden creciente"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-005 — Con lotes de 100 el consumidor agrupado observa las versiones de un agregado en orden

## Intención

Un consumidor DEBE (MUST) poder declarar que su efecto recalcula estado y no depende del orden de los eventos de agregados distintos dentro de un mismo lote; para ese consumidor, el sistema DEBE (MUST) entregar los eventos de un lote que pertenecen al mismo workspace en una sola transacción de base de datos que registre en el inbox todos los eventos aún no procesados e invoque el efecto una sola vez con ellos, con el aislamiento de ese workspace.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando un agregado tiene pendientes sus versiones 1 a 10 y el consumidor agrupado toma lotes de 100
Entonces cada lote trae a lo sumo una versión de ese agregado
  Y el consumidor observa las versiones 1 a 10 en orden creciente
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
