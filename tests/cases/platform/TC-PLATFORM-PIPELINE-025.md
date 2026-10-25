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
automation_status: automated
automated_tests:
  - apps/api/test/perf/isolation.test.ts
  - apps/api/test/perf/perf-report.test.ts
  - apps/api/test/perf/suite-order.test.ts
status: automated
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
updated: 2026-10-25
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
- Parte 1 implementada el 2026-10-23 (tarea 2.4): `commitments.perf.ts` cuenta los trabajos de la cola del matcher antes de encolar la ráfaga y con la ráfaga encolada, y los publica en la sección de carga de fondo del reporte, junto con el ev/s del primer al último evento de la ráfaga (`burstWindow`, con test unitario) y el ev/s desde el arranque del consumidor. La aserción de D112 (≥ 42 ev/s desde el arranque) no cambia. Sigue `not_automated`: la cola vacía depende de la purga de D291 (tarea 5.2) y la medición real la valida `nightly` por `workflow_dispatch` (tarea 7.2).
- Implementado el 2026-10-25 (parte 2, tareas 5.1 a 5.3): la purga de D291 (`purgeBacklog`, `isolation.test.ts`) corre antes de la foto de inicio de `commitments.perf.ts`, que además corre después de las suites de latencia y antes de `imports` (`PERF_SUITE_ORDER`), y la precondición hace fallar la suite si queda backlog ajeno; `burstWindow` calcula el ev/s solo con los eventos de la ráfaga. Las aserciones y umbrales de TC-COMMITMENTS-MATCH-012 no cambian. **Que la cola del matcher contenga exactamente los 1 050 eventos (matcher 161–175 ev/s medidos con purga en la rama de experimentos) lo valida `nightly` por `workflow_dispatch` (tarea 7.2).**
- Validado en el nightly programado (run 40186569273 en `main` (programado, 2026-10-25, 10:52–11:51 UTC, commit 72ff10d): TC-COMMITMENTS-MATCH-012 en OK (≥ 42 ev/s) con la cola del matcher purgada antes de la suite; la carga de fondo de `commitments.perf.ts` (trabajos de la cola antes de la ráfaga y con ella encolada) quedó publicada en el reporte. Aserciones y umbrales sin cambios.
