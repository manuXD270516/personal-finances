---
id: TC-COMMITMENTS-SUBS-010
title: 'La próxima renovación omite las ocurrencias omitidas o pagadas y respeta el fin de mes'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Próxima renovación derivada del ciclo'
scenario: 'Renovación omitida'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-012', 'FR-COMMITMENTS-005']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'next-renewal', 'end-of-month']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"Streamly" renueva el día 15'
  - '"Gimnasio Centro" renueva el día 31'
input:
  cases: ['hoy 2026-11-15 con 2026-11-15 materializada', 'hoy 2026-12-01 con 2026-12-15 omitida', 'hoy 2027-02-10 (Gimnasio Centro)']
steps:
  - 'Consultar la próxima renovación en cada caso'
expected_result:
  - '2026-12-15'
  - '2027-01-15'
  - '2027-02-28'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-010 — La próxima renovación omite las ocurrencias omitidas o pagadas y respeta el fin de mes

## Intención

Q8: la próxima renovación debe coincidir con la próxima ocurrencia pendiente del motor.

## Escenario

```gherkin
Dado "Streamly" con el cargo del 2026-12-15 omitido
Cuando consulto el 2026-12-01
Entonces la próxima renovación es 2027-01-15
```

## Notas

- Cubre también los scenarios "Renovación pagada" y "Día 31 en un mes corto".
- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
