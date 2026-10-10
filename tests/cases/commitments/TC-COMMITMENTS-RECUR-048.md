---
id: TC-COMMITMENTS-RECUR-048
title: 'Cambiar el día del mes cancela la ocurrencia vieja y genera la nueva'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Cambiar esta y las siguientes'
scenario: 'Cambio de día del mes'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-009']
nfr: []
invariants: ['INV-013']
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/generation.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'revision']
error_code: null
preconditions:
  - 'Internet MONTHLY día 20 con 2026-11-20 SCHEDULED'
input:
  effectiveFrom: '2026-11-01'
  monthDay: '10'
steps:
  - 'RevisionPlanner para la revisión'
expected_result:
  - '2026-11-20 CANCELLED (SUPERSEDED)'
  - '2026-11-10 creada con versión 2'
  - 'Una revisión posterior que vuelva al día 20 reinstaura la cancelada (REINSTATE) sin duplicar'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-048 — Cambiar el día del mes cancela la ocurrencia vieja y genera la nueva

## Intención

CANCELLED no terminal permite reinstaurar fechas sin violar INV-013.

## Escenario

```gherkin
Dado el "Internet" del día 20
Cuando se revisa al día 10 desde 2026-11-01
Entonces la ocurrencia del 2026-11-20 queda cancelada y se genera la del 2026-11-10
```

## Notas

