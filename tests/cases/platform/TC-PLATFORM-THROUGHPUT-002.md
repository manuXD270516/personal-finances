---
id: TC-PLATFORM-THROUGHPUT-002
title: "La entrega agrupada no vuelve a aplicar los eventos que el inbox ya registró"
spec: platform/event-delivery
related_specs: ["imports/import-pipeline"]
requirement: "Entrega agrupada para consumidores que recalculan estado"
scenario: "Eventos ya procesados dentro del lote"
requirement_status: provisional
fr: []
nfr: ["NFR-PERF-008", "NFR-REL-008"]
invariants: ["INV-028"]
priority: critical
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
input: "Datos del scenario \"Eventos ya procesados dentro del lote\" del delta de optimize-consumer-throughput"
steps:
  - "el lote de 100 eventos de \"W1 Personal Demo\" contiene 3 eventos que el consumidor ya registró en su inbox por una entrega anterior"
expected_result:
  - "el efecto se invoca con los 97 eventos restantes"
  - "los 3 eventos repetidos no vuelven a aplicarse"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-002 — La entrega agrupada no vuelve a aplicar los eventos que el inbox ya registró

## Intención

Un consumidor DEBE (MUST) poder declarar que su efecto recalcula estado y no depende del orden de los eventos de agregados distintos dentro de un mismo lote; para ese consumidor, el sistema DEBE (MUST) entregar los eventos de un lote que pertenecen al mismo workspace en una sola transacción de base de datos que registre en el inbox todos los eventos aún no procesados e invoque el efecto una sola vez con ellos, con el aislamiento de ese workspace.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando el lote de 100 eventos de "W1 Personal Demo" contiene 3 eventos que el consumidor ya registró en su inbox por una entrega anterior
Entonces el efecto se invoca con los 97 eventos restantes
  Y los 3 eventos repetidos no vuelven a aplicarse
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
