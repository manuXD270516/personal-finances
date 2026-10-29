---
id: TC-PLATFORM-THROUGHPUT-011
title: "Las métricas registran los eventos por invocación y los grupos reintentados de un consumidor agrupado"
spec: platform/event-delivery
related_specs: ["imports/import-pipeline"]
requirement: "Métricas de la entrega agrupada"
scenario: "Grupo aplicado y grupo reintentado"
requirement_status: provisional
fr: []
nfr: ["NFR-OBS-004", "NFR-PERF-008"]
invariants: []
priority: medium
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["event-delivery", "throughput", "D301", "metrics"]
error_code: null
preconditions:
  - "Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor"
  - "Workspaces ficticios \"W1 Personal Demo\" y \"W2 Familia Demo\""
input: "Datos del scenario \"Grupo aplicado y grupo reintentado\" del delta de optimize-consumer-throughput"
steps:
  - "el consumidor agrupado `reporting.data-version` aplica un grupo de 100 eventos y luego un grupo de 10 eventos falla y se reintenta de a uno"
expected_result:
  - "la métrica de eventos por invocación registra una observación de 100 para `consumer=\"reporting.data-version\"`"
  - "la métrica de grupos reintentados evento por evento de ese consumidor sube en 1"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-011 — Las métricas registran los eventos por invocación y los grupos reintentados de un consumidor agrupado

## Intención

El sistema DEBE (MUST) exponer, por consumidor agrupado y sin etiquetas de alta cardinalidad (workspace, usuario, agregado), la cantidad de eventos aplicados por cada invocación del efecto y la cantidad de grupos que fallaron y se reintentaron evento por evento, además de las métricas de pendientes y duración por consumidor que ya existen.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando el consumidor agrupado `reporting.data-version` aplica un grupo de 100 eventos y luego un grupo de 10 eventos falla y se reintenta de a uno
Entonces la métrica de eventos por invocación registra una observación de 100 para `consumer="reporting.data-version"`
  Y la métrica de grupos reintentados evento por evento de ese consumidor sube en 1
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
