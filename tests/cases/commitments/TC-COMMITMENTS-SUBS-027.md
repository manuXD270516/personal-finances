---
id: TC-COMMITMENTS-SUBS-027
title: 'El recordatorio de renovación se publica una sola vez N días antes en la zona del workspace'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Recordatorio de renovación'
scenario: 'Evaluación repetida'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-016', 'FR-NOTIFY-005']
nfr: []
invariants: ['INV-028']
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/subscriptions.api.test.ts
  - apps/api/test/perf/subscriptions.perf.ts
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
  - packages/contexts/commitments/src/domain/subscription/pricing.test.ts
  - packages/contexts/commitments/test/integration/pg-subscriptions.int.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'reminders', 'idempotency', 'timezone']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"Streamly" ACTIVE, renovación 2026-11-15, recordatorio 3 días'
input:
  runs: ['2026-11-11T23:30-04:00', '2026-11-12T06:00-04:00', '2026-11-12T07:00-04:00', '2026-11-13T06:00-04:00']
steps:
  - 'Ejecutar commitments.subscription-daily en cada instante'
expected_result:
  - '23:30 del 11: nada'
  - '06:00 del 12: un SubscriptionRenewalUpcoming.v1 para 2026-11-15 (daysBefore 3)'
  - 'Corridas siguientes: ningún evento adicional'
  - 'Una fila en subscription_reminder (RENEWAL, 2026-11-15)'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-027 — El recordatorio de renovación se publica una sola vez N días antes en la zona del workspace

## Intención

FR-COMMITMENTS-016 + FR-NOTIFY-005: recordatorios exactamente una vez por fecha.

## Escenario

```gherkin
Dado "Streamly" que renueva el 2026-11-15 con aviso a 3 días
Cuando la evaluación corre el 2026-11-12 y el 2026-11-13
Entonces se publica un solo recordatorio
```

## Notas

- Cubre "Tres días antes" y "Suscripción creada dentro de la ventana" (alta el 2026-11-14 con renovación 2026-11-15 ⇒ recordatorio en la siguiente corrida horaria).
- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
