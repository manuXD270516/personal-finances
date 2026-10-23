---
id: TC-PLATFORM-PIPELINE-025
title: "La ráfaga de 1 050 eventos del matcher se mide con la cola conteniendo solo sus propios eventos"
spec: platform/delivery-pipeline
related_specs: ["commitments/recurrence-engine", "platform/event-delivery"]
requirement: "El benchmark nocturno mide sin interferencia de carga de fondo"
scenario: "Ráfaga del matcher sin backlog ajeno"
requirement_status: confirmed
fr: []
nfr: [NFR-PERF-008]
invariants: []
priority: high
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["nightly", "perf", "background-load", "matcher"]
error_code: null
preconditions:
  - "Suite commitments.perf.ts con 12 ocurrencias pendientes compatibles"
  - "Purga del backlog residual en la base efímera tras la medición de throughput (D291)"
input:
  burst: "1000 TransactionCreated.v1 de origen IMPORT y 50 reentregados (1 050 eventos)"
  goal_events_per_second: 42
steps:
  - "Antes de iniciar el consumidor, contar los trabajos en la cola del matcher y publicarlos en el reporte"
  - "Medir el tiempo hasta que el inbox del workspace de la suite registra los 1 050 eventos"
expected_result:
  - "Al empezar la medición la cola del matcher contiene exactamente los 1 050 eventos de la ráfaga"
  - "El throughput se calcula como 1 050 eventos entre los segundos medidos"
  - "Siguen existiendo exactamente 12 sugerencias PROPOSED (TC-COMMITMENTS-MATCH-012)"
created: 2026-10-21
updated: 2026-10-23
---

# TC-PLATFORM-PIPELINE-025 — La ráfaga de 1 050 eventos del matcher se mide con la cola conteniendo solo sus propios eventos

## Intención

S1 de `investigate-perf-under-load`: el matcher dio ~6 ev/s frente a ≥ 42. Si la cola compartida tenía trabajos del Large Seed (hipótesis H1), el benchmark medía el backlog ajeno y no la ráfaga.

## Escenario

```gherkin
Dada la suite de compromisos con su ráfaga de 1 050 eventos
Cuando empieza la medición del matcher
Entonces la cola del matcher contiene solo los eventos de la ráfaga
  Y el throughput se calcula solo con esos eventos
```

## Notas

- Change `investigate-perf-under-load` (D290). No cambia la meta de D112 (≥ 42 ev/s) ni las aserciones de TC-COMMITMENTS-MATCH-012.
- `provisional` hasta la pregunta 1 de docs/47.
- Confirmado (2026-10-23, D291 de [docs/48](../../../docs/48-perf-and-rls-owner-decisions.md)): aislamiento por purga del backlog residual tras la medición de throughput; `requirement_status` pasa a `confirmed`.
