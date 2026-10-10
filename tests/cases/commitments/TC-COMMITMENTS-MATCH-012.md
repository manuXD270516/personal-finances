---
id: TC-COMMITMENTS-MATCH-012
title: 'Las candidatas de una vista previa no se persisten y una ráfaga de 1000 importadas no duplica sugerencias'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Candidatas para filas de un import'
scenario: 'Lote importado'
requirement_status: provisional
fr: ['FR-COMMITMENTS-010']
nfr: ['NFR-PERF-008']
invariants: ['INV-028']
priority: high
type: integration
level: performance
automation_status: not_automated
automated_tests: []
status: draft
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
updated: 2026-10-09
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
