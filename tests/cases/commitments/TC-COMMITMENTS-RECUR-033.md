---
id: TC-COMMITMENTS-RECUR-033
title: 'Una definición con máximo de 12 ocurrencias termina tras la última'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Fecha de fin o número máximo de ocurrencias'
scenario: 'Doce cuotas de un curso'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-009']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/definition.test.ts
  - packages/contexts/commitments/src/domain/generation.test.ts
  - packages/shared-kernel/src/recurrence/recurrence.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'count']
error_code: null
preconditions:
  - 'Curso de inglés FIXED 400.00 BOB MONTHLY desde 2026-10-15, maxOccurrences 12'
input: {}
steps:
  - 'Generar con horizonte amplio'
  - 'Avanzar el reloj a 2027-09-16 sin resolver la última'
expected_result:
  - 'Última ocurrencia 2027-09-15; ninguna posterior'
  - 'La definición pasa a ENDED cuando no quedan fechas por generar y hoy supera la última'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-033 — Una definición con máximo de 12 ocurrencias termina tras la última

## Intención

FR-COMMITMENTS-009: COUNT.

## Escenario

```gherkin
Dado el "Curso de inglés" mensual desde 2026-10-15 con máximo 12 ocurrencias
Cuando se generan sus ocurrencias
Entonces la última es la del 2027-09-15
```

## Notas

- Fechas de fin y máximo juntos ⇒ RECURRING_INVALID_SCHEDULE.
