---
id: TC-AUDIT-PERIODLIFECYCLE-001
title: El recorrido del periodo muestra crear, activar, cerrar, reabrir y re-cerrar
spec: audit/lifecycle-timeline
related_specs:
  - planning/month-closing
  - planning/financial-periods
requirement: Recorrido de un periodo financiero
scenario: Recorrido completo de octubre
requirement_status: confirmed
fr:
  - FR-AUDIT-009
  - FR-AUDIT-010
  - FR-PLANNING-006
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - lifecycle
  - month-closing
error_code: null
preconditions:
  - '"2026-10" creado en draft por el proceso, activado automáticamente, cerrado por EDITOR (snapshot 1), reabierto por OWNER con motivo y cerrado de nuevo (snapshot 2)'
  - '"2026-12" recalculado por cambio del día de inicio'
  - Usuario VIEWER
input:
  - period: 2026-10
  - period: 2026-12
steps:
  - GET /periods/{id}/lifecycle de "2026-10"
  - GET /periods/{id}/lifecycle de "2026-12"
expected_result:
  - '"2026-10": crear (draft), activar (draft -> active), cerrar (active -> closed, snapshot 1), reabrir (closed -> reopened, motivo), cerrar (reopened -> closed, snapshot 2); estado actual closed'
  - '"2026-12": anotación con rango anterior y nuevo, sin transición de estado'
created: 2026-10-05
updated: 2026-10-08
---

# TC-AUDIT-PERIODLIFECYCLE-001 — El recorrido del periodo muestra crear, activar, cerrar, reabrir y re-cerrar

## Intención

docs/31 D37: el ciclo de vida de cada elemento es un flujo trazable; el periodo es el agregado más sensible de Phase 2.

## Escenario

```gherkin
Dado que "2026-10" se cerró, se reabrió y se cerró de nuevo
Cuando un VIEWER consulta su recorrido
Entonces ve cinco transiciones en orden con el motivo de la reapertura y las versiones del snapshot
```

## Notas

- Cubre "Recálculo como anotación".
