---
id: TC-COMMITMENTS-SUBS-029
title: 'El recorrido de una suscripción muestra sus transiciones en orden con actor e instante'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Recorrido de la suscripción'
scenario: 'Recorrido de una suscripción con trial'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-012', 'FR-AUDIT-009']
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/subscriptions.api.test.ts
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'lifecycle']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"CloudDrive": alta en trial 2026-10-20 (EDITOR), fin de trial 2026-11-20 (proceso), pausa 2027-01-03 (EDITOR)'
input:
  endpoint: 'GET W/subscriptions/{id}/lifecycle'
steps:
  - 'Consultar el recorrido como VIEWER'
expected_result:
  - 'Transiciones en orden: CREATE→TRIAL, TRIAL_END→ACTIVE (actor proceso), PAUSE→PAUSED'
  - 'Cambios de precio como anotaciones, no transiciones'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-029 — El recorrido de una suscripción muestra sus transiciones en orden con actor e instante

## Intención

docs/31 D37: ciclo de vida trazable como máquina de estados (pregunta 4).

## Escenario

```gherkin
Dado "CloudDrive" con alta, fin de trial y pausa
Cuando consulto su recorrido
Entonces veo las tres transiciones en orden con actor e instante
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
