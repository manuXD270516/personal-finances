---
id: TC-COMMITMENTS-MATCH-012
title: 'Las candidatas de una vista previa no se persisten y una ráfaga de 1000 importadas no duplica sugerencias'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Candidatas para filas de un import'
scenario: 'Lote importado'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-010']
nfr: ['NFR-PERF-008']
invariants: ['INV-028']
priority: high
type: integration
level: performance
automation_status: automated
automated_tests:
  - apps/api/test/events/event-throughput.int.test.ts
  - apps/api/test/perf/commitments.perf.ts
  - packages/contexts/commitments/src/application/matching.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['matching', 'imports']
error_code: null
preconditions:
  - '12 ocurrencias pendientes compatibles con 12 de 1000 transacciones a importar'
input:
  preview: 'fila 199.00 BOB 2026-10-20 Banco BOB'
  batch: '1000 TransactionCreated.v1 origin IMPORT, 50 reentregados'
steps:
  - 'OccurrenceMatchCandidatesQuery.findCandidates para la fila'
  - 'Publicar el lote y drenar el consumidor'
expected_result:
  - 'La consulta devuelve el Internet del 2026-10-20 con su puntaje y no inserta filas'
  - 'Exactamente 12 sugerencias PROPOSED'
  - 'Drenado dentro de la meta de D112 (≥ 42 eventos/s)'
created: 2026-10-09
updated: 2026-10-27
---

# TC-COMMITMENTS-MATCH-012 — Las candidatas de una vista previa no se persisten y una ráfaga de 1000 importadas no duplica sugerencias

## Intención

Preparar Phase 6 sin cambiar el modelo.

## Escenario

```gherkin
Dado 12 ocurrencias pendientes compatibles
Cuando se importan 1000 transacciones y algunos hechos se entregan dos veces
Entonces existen exactamente 12 sugerencias propuestas
```

## Notas

- Cubre el scenario "Vista previa de un extracto". Suite perf nightly para la parte de throughput.
- 2026-10-21 (D290, [docs/46](../../../docs/46-nightly-and-perf-owner-decisions.md)): el benchmark nocturno del matcher da ~6 ev/s frente a ≥ 42 ev/s (run 39669892721); la causa la investiga el change `investigate-perf-under-load` (síntoma S1; hipótesis principal: la cola del matcher contiene backlog del Large Seed). La meta de D112 no cambia.
- 2026-10-25 (informe del change 48, [docs/50](../../../docs/50-perf-under-load-findings.md), síntoma S1): **causa medida, backlog ajeno en la cola del matcher (H1).** Tras la fase de throughput de `nightly.perf.ts` quedan ~1,39 M trabajos `events.*` (E10, run 40154960947) y el matcher de la suite procesa primero los ajenos (en `main`, 150 560 en su cola antes de la ráfaga, ~6 ev/s). En limpio rinde 104,8 ev/s de mediana [104,6, 142,2] (E1 ×3) y con la purga tras el Large Seed 161,12 ev/s (E11, run 40160392746). Camino: arreglo del benchmark (purga del backlog residual, D291, y precondición de aislamiento; grupo 5 del change 48). La meta de D112 no cambia.
- 2026-10-27 (cierre del change 48, D303 de [docs/52](../../../docs/52-perf-under-load-owner-decisions.md)): registro de causa, mediciones y camino en [docs/23 §5.5](../../../docs/23-ci-cd.md) («Causas medidas y cierre»). Confirmado en GitHub con la purga y la quietud: OK en los nightlies programados 40186569273 (2026-10-25) y 40322158874 (2026-10-26). La meta de D112 no cambió.
