---
id: TC-COMMITMENTS-SUBS-005
title: 'El listado de suscripciones excluye las canceladas salvo al filtrar por ese estado'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Listado y detalle de suscripciones'
scenario: 'Listado por defecto sin canceladas'
requirement_status: provisional
fr: ['FR-COMMITMENTS-012']
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['subscriptions', 'list']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"Streamly" ACTIVE, "CloudDrive" TRIAL, "MusicBox" PAUSED, "OldTV" CANCELLED'
input:
  role: 'VIEWER'
  filters: ['ninguno', 'status=CANCELLED']
steps:
  - 'GET W/subscriptions'
  - 'GET W/subscriptions?status=CANCELLED'
expected_result:
  - 'Primera respuesta: Streamly, CloudDrive y MusicBox con su estado'
  - 'Segunda respuesta: solo OldTV'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-SUBS-005 — El listado de suscripciones excluye las canceladas salvo al filtrar por ese estado

## Intención

El owner ve sus compromisos vigentes sin ruido de las canceladas, sin perder la historia.

## Escenario

```gherkin
Dado cuatro suscripciones en estados distintos
Cuando el VIEWER lista sin filtros
Entonces ve tres suscripciones
  Y OldTV solo aparece al filtrar por canceladas
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
