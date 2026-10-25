---
id: TC-REPORTING-SPENDABLE-014
title: "El cálculo del disponible cabe en el presupuesto del Home con un workspace grande y expone su métrica"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Rendimiento y métricas del disponible"
scenario: "Workspace grande"
requirement_status: confirmed
fr: ["FR-REPORTING-002"]
nfr: ["NFR-PERF-004", "NFR-OBS-004"]
invariants: []
priority: medium
type: platform
level: performance
automation_status: automated
automated_tests:
  - apps/api/test/perf/spendable.perf.ts
  - packages/contexts/reporting/src/application/spendable.queries.test.ts
  - packages/contexts/reporting/src/domain/upcoming-read-model-alert.test.ts
status: automated
regression_suite: false
phase: 4
tags: ["spendable", "q5", "perf"]
error_code: null
preconditions:
  - "Dataset con 40 cuentas, 300 ocurrencias no resueltas en el periodo, 20 metas con reservas (benchmark en BOB: las monedas adicionales solo suman una tasa por petición, una sola resolución de FX)"
input: {}
steps:
  - "Benchmark de GET W/reports/summary con el bloque spendable (nightly perf)"
expected_result:
  - "p95 de reporting_spendable_duration_seconds ≤ 0.30 s"
  - "Métrica sin etiquetas de alta cardinalidad"
created: 2026-10-10
updated: 2026-10-25
---

# TC-REPORTING-SPENDABLE-014 — El cálculo del disponible cabe en el presupuesto del Home con un workspace grande y expone su métrica

## Intención

NFR-PERF-004: el Home no se degrada por Q5.

## Escenario

```gherkin
Dado un workspace con 40 cuentas, 300 ocurrencias y 20 metas
Cuando se mide el resumen del Home
Entonces el p95 del disponible es como máximo 0.30 s
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
- 2026-10-21 (D290, [docs/46](../../../docs/46-nightly-and-perf-owner-decisions.md)): en el nightly manual 39669892721 los dos benchmarks de `spendable.perf.ts` dieron p95 de 352,2 ms y 341,1 ms frente a 300 ms (primera medición; antes caían por 429). Causa sin determinar; la investiga el change `investigate-perf-under-load` (síntoma S2). El umbral no cambia sin decisión del owner.
- 2026-10-25 (informe del change 48, [docs/50](../../../docs/50-perf-under-load-findings.md), síntoma S2): **causa medida, contención de CPU del host (H2); el código está sano (H7 descartada).** En limpio, p95 de 65,26 ms de mediana [53,2, 66,87] (E1 ×3); con el Large Seed y el host tranquilo (carga a 1 min 2,9–3,5), 42–78 ms; con el host ocupado por el trabajo residual de la suite anterior, 200–210 ms (carga 7,5, E11) y 354–359 ms (carga 7,96, `main`). El backlog del outbox por sí solo no degrada la consulta (E2). Camino: arreglo del benchmark (precondición de quietud del host y orden determinista de los archivos; grupo 5 del change 48). El umbral de 300 ms no cambia.
