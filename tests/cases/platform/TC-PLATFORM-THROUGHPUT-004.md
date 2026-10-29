---
id: TC-PLATFORM-THROUGHPUT-004
title: "Un lote con dos workspaces se entrega en dos invocaciones aisladas por workspace"
spec: platform/event-delivery
related_specs: ["imports/import-pipeline"]
requirement: "Entrega agrupada para consumidores que recalculan estado"
scenario: "Lote con eventos de dos workspaces"
requirement_status: provisional
fr: []
nfr: ["NFR-PERF-008", "NFR-REL-008"]
invariants: ["INV-025"]
priority: critical
type: security
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
input: "Datos del scenario \"Lote con eventos de dos workspaces\" del delta de optimize-consumer-throughput"
steps:
  - "un lote trae 60 eventos de \"W1 Personal Demo\" y 40 de \"W2 Familia Demo\" para un consumidor agrupado"
expected_result:
  - "el efecto se invoca dos veces, una por workspace, cada una con el aislamiento de su workspace"
  - "ninguna invocación ve datos del otro workspace"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-004 — Un lote con dos workspaces se entrega en dos invocaciones aisladas por workspace

## Intención

Un consumidor DEBE (MUST) poder declarar que su efecto recalcula estado y no depende del orden de los eventos de agregados distintos dentro de un mismo lote; para ese consumidor, el sistema DEBE (MUST) entregar los eventos de un lote que pertenecen al mismo workspace en una sola transacción de base de datos que registre en el inbox todos los eventos aún no procesados e invoque el efecto una sola vez con ellos, con el aislamiento de ese workspace.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando un lote trae 60 eventos de "W1 Personal Demo" y 40 de "W2 Familia Demo" para un consumidor agrupado
Entonces el efecto se invoca dos veces, una por workspace, cada una con el aislamiento de su workspace
  Y ninguna invocación ve datos del otro workspace
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
