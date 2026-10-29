---
id: TC-PLATFORM-THROUGHPUT-003
title: "Un grupo que falla se reintenta evento por evento y solo el evento culpable queda en reintento"
spec: platform/event-delivery
related_specs: ["imports/import-pipeline"]
requirement: "Entrega agrupada para consumidores que recalculan estado"
scenario: "Fallo dentro de un grupo"
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
input: "Datos del scenario \"Fallo dentro de un grupo\" del delta de optimize-consumer-throughput"
steps:
  - "un grupo de 10 eventos de agregados distintos falla porque el efecto no puede aplicar el evento del agregado A"
expected_result:
  - "ningún efecto del grupo queda confirmado y los 10 eventos se reintentan de a uno"
  - "los 9 eventos de los otros agregados se registran en el inbox una sola vez"
  - "solo el evento del agregado A queda en reintento"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-003 — Un grupo que falla se reintenta evento por evento y solo el evento culpable queda en reintento

## Intención

Un consumidor DEBE (MUST) poder declarar que su efecto recalcula estado y no depende del orden de los eventos de agregados distintos dentro de un mismo lote; para ese consumidor, el sistema DEBE (MUST) entregar los eventos de un lote que pertenecen al mismo workspace en una sola transacción de base de datos que registre en el inbox todos los eventos aún no procesados e invoque el efecto una sola vez con ellos, con el aislamiento de ese workspace.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando un grupo de 10 eventos de agregados distintos falla porque el efecto no puede aplicar el evento del agregado A
Entonces ningún efecto del grupo queda confirmado y los 10 eventos se reintentan de a uno
  Y los 9 eventos de los otros agregados se registran en el inbox una sola vez
  Y solo el evento del agregado A queda en reintento
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
