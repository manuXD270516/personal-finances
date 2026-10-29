---
id: TC-PLATFORM-THROUGHPUT-001
title: "Un consumidor agrupado aplica 100 eventos del mismo workspace en una transacción y una sola invocación"
spec: platform/event-delivery
related_specs: ["imports/import-pipeline"]
requirement: "Entrega agrupada para consumidores que recalculan estado"
scenario: "Ráfaga del mismo workspace aplicada en una transacción"
requirement_status: provisional
fr: []
nfr: ["NFR-PERF-008", "NFR-REL-008"]
invariants: ["INV-028"]
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
input: "Datos del scenario \"Ráfaga del mismo workspace aplicada en una transacción\" del delta de optimize-consumer-throughput"
steps:
  - "un consumidor agrupado con lotes de 100 tiene pendientes 100 eventos de 100 transacciones distintas de \"W1 Personal Demo\""
expected_result:
  - "el efecto se invoca una sola vez con los 100 eventos dentro de una transacción con el aislamiento de \"W1 Personal Demo\""
  - "el inbox registra los 100 eventos para ese consumidor"
  - "el estado resultante es el mismo que si los 100 eventos se hubieran procesado de a uno"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-001 — Un consumidor agrupado aplica 100 eventos del mismo workspace en una transacción y una sola invocación

## Intención

Un consumidor DEBE (MUST) poder declarar que su efecto recalcula estado y no depende del orden de los eventos de agregados distintos dentro de un mismo lote; para ese consumidor, el sistema DEBE (MUST) entregar los eventos de un lote que pertenecen al mismo workspace en una sola transacción de base de datos que registre en el inbox todos los eventos aún no procesados e invoque el efecto una sola vez con ellos, con el aislamiento de ese workspace.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando un consumidor agrupado con lotes de 100 tiene pendientes 100 eventos de 100 transacciones distintas de "W1 Personal Demo"
Entonces el efecto se invoca una sola vez con los 100 eventos dentro de una transacción con el aislamiento de "W1 Personal Demo"
  Y el inbox registra los 100 eventos para ese consumidor
  Y el estado resultante es el mismo que si los 100 eventos se hubieran procesado de a uno
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
