---
id: TC-COMMITMENTS-RECUR-032
title: 'Pausar cancela las ocurrencias futuras y reanudar reinstaura las posteriores sin recrear el intervalo pausado'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Pausar y reanudar una definición'
scenario: 'Gimnasio pausado dos meses'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-009']
nfr: []
invariants: ['INV-013']
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/generation.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'pause']
error_code: null
preconditions:
  - 'Gimnasio MONTHLY día 28 con ocurrencias 2026-10-28..2027-01-28 SCHEDULED'
input:
  pause: '2026-10-10'
  resume: '2026-12-01'
steps:
  - 'Pausar con hoy 2026-10-10'
  - 'Reanudar con hoy 2026-12-01'
expected_result:
  - '2026-10-28 y 2026-11-28 CANCELLED (PAUSED)'
  - '2026-12-28 y 2027-01-28 SCHEDULED (REINSTATE) y se generan las siguientes hasta 2027-03-01'
  - 'RecurringDefinitionChanged.v1 PAUSE y RESUME con los ids afectados'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-032 — Pausar cancela las ocurrencias futuras y reanudar reinstaura las posteriores sin recrear el intervalo pausado

## Intención

FR-COMMITMENTS-009: pause/resume sin duplicados ni recrear lo pausado.

## Escenario

```gherkin
Dado el "Gimnasio" mensual del día 28
Cuando se pausa el 2026-10-10 y se reanuda el 2026-12-01
Entonces las ocurrencias de octubre y noviembre quedan canceladas
  Y la del 2026-12-28 queda programada
```

## Notas

