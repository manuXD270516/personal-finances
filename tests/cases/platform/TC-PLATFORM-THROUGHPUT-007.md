---
id: TC-PLATFORM-THROUGHPUT-007
title: "Cada consumidor agrupado deja el mismo estado entregado de a uno o agrupado en cualquier orden"
spec: platform/event-delivery
related_specs: ["imports/import-pipeline"]
requirement: "Entrega agrupada para consumidores que recalculan estado"
scenario: "Ráfaga del mismo workspace aplicada en una transacción"
requirement_status: provisional
fr: []
nfr: ["NFR-PERF-008", "NFR-REL-008"]
invariants: ["INV-028"]
priority: high
type: property
level: property
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
  - "Generar con fast-check conjuntos de eventos de agregados distintos para cada consumidor que opta por la agrupación"
  - "Entregarlos de a uno en un workspace y agrupados en órdenes al azar en otro workspace idéntico"
expected_result:
  - "El estado final que deja el consumidor es el mismo en ambos workspaces para toda entrada generada"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-007 — Cada consumidor agrupado deja el mismo estado entregado de a uno o agrupado en cualquier orden

## Intención

Un consumidor DEBE (MUST) poder declarar que su efecto recalcula estado y no depende del orden de los eventos de agregados distintos dentro de un mismo lote; para ese consumidor, el sistema DEBE (MUST) entregar los eventos de un lote que pertenecen al mismo workspace en una sola transacción de base de datos que registre en el inbox todos los eventos aún no procesados e invoque el efecto una sola vez con ellos, con el aislamiento de ese workspace.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando Generar con fast-check conjuntos de eventos de agregados distintos para cada consumidor que opta por la agrupación
  Y Entregarlos de a uno en un workspace y agrupados en órdenes al azar en otro workspace idéntico
Entonces El estado final que deja el consumidor es el mismo en ambos workspaces para toda entrada generada
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
- Test de equivalencia de la decisión 3 de design.md; uno por consumidor convertido (tarea 5.1).
