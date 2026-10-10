---
id: TC-COMMITMENTS-SUBS-007
title: 'Una transición no permitida se rechaza sin cambiar el estado'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Estados y transiciones de la suscripción'
scenario: 'Pausar una suscripción en trial'
requirement_status: provisional
fr: ['FR-COMMITMENTS-012']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['subscriptions', 'state-machine']
error_code: 'INVALID_STATUS_TRANSITION'
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"CloudDrive" en TRIAL hasta 2026-11-20'
  - '"OldTV" CANCELLED'
input:
  commands: ['pause CloudDrive', 'resume OldTV']
steps:
  - 'Pausar "CloudDrive"'
  - 'Reanudar "OldTV"'
expected_result:
  - 'Ambas operaciones se rechazan con INVALID_STATUS_TRANSITION'
  - '"CloudDrive" sigue TRIAL y "OldTV" sigue CANCELLED'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-SUBS-007 — Una transición no permitida se rechaza sin cambiar el estado

## Intención

docs/31 D37: ciclo de vida como máquina de estados explícita; CANCELLED es terminal.

## Escenario

```gherkin
Dado "CloudDrive" en trial
Cuando intento pausarla
Entonces se rechaza con INVALID_STATUS_TRANSITION
  Y sigue en trial
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
