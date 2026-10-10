---
id: TC-COMMITMENTS-SUBS-019
title: 'Una cancelación programada mantiene el estado hasta la fecha y puede deshacerse'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Cancelación programada al fin del ciclo pagado'
scenario: 'Cancelar al terminar el mes pagado'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-017', 'FR-COMMITMENTS-012']
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/subscriptions.api.test.ts
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
  - packages/contexts/commitments/src/domain/subscription/subscription.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'cancel', 'scheduled', 'timezone']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"Streamly" (día 15) pagada el 2026-11-15'
  - 'Hoy 2026-11-20'
input:
  effectiveOn: '2026-12-15'
steps:
  - 'Programar la cancelación'
  - 'Ejecutar el job el 2026-12-14 23:30 y el 2026-12-15 00:05 (La Paz)'
  - 'En otra corrida: deshacer el 2026-12-01'
expected_result:
  - 'Hasta el 14: ACTIVE con cancelación programada y sin ocurrencia pendiente del 2026-12-15'
  - 'El 15 a las 00:05: CANCELLED con fecha 2026-12-15 y SubscriptionCancelled.v1 (scheduled true)'
  - 'Deshacer el 2026-12-01: ACTIVE sin programación y próxima renovación 2026-12-15'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-019 — Una cancelación programada mantiene el estado hasta la fecha y puede deshacerse

## Intención

Modela "cancelé pero tengo servicio hasta fin de ciclo" sin estado extra (pregunta 5).

## Escenario

```gherkin
Dado "Streamly" pagada el 2026-11-15
Cuando programo la cancelación para el 2026-12-15
Entonces sigue activa sin cargo del 2026-12-15
  Y el 2026-12-15 queda cancelada
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
