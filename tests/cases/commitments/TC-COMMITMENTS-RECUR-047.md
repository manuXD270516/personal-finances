---
id: TC-COMMITMENTS-RECUR-047
title: 'Terminar una definición con fecha de fin cancela las ocurrencias posteriores'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Fecha de fin o número máximo de ocurrencias'
scenario: 'Terminar el internet al mudarse'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-009']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/generation.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'end']
error_code: null
preconditions:
  - 'Internet MONTHLY día 20 con ocurrencias hasta 2027-01-20'
  - 'Hoy 2026-10-09'
input:
  endDate: '2026-11-30'
steps:
  - 'EndDefinition(endDate 2026-11-30)'
  - 'Avanzar el reloj a 2026-12-01'
expected_result:
  - '2026-12-20 y 2027-01-20 CANCELLED (ENDED)'
  - '2026-10-20 y 2026-11-20 siguen resolubles'
  - 'La definición pasa a ENDED el 2026-12-01'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-047 — Terminar una definición con fecha de fin cancela las ocurrencias posteriores

## Intención

FR-COMMITMENTS-009: end date.

## Escenario

```gherkin
Dado el "Internet" mensual del día 20
Cuando el EDITOR lo termina con fecha de fin 2026-11-30
Entonces se cancelan las ocurrencias desde el 2026-12-20
```

## Notas

