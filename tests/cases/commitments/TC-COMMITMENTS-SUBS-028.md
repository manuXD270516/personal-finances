---
id: TC-COMMITMENTS-SUBS-028
title: 'El recordatorio de fin de trial se publica una sola vez con el precio del primer cobro'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Recordatorio de fin de trial'
scenario: 'Trial que termina en tres días'
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
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
  - packages/contexts/commitments/src/domain/subscription/pricing.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'reminders', 'trial']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"CloudDrive" TRIAL hasta 2026-11-20, recordatorio 3 días, primer cobro 99.99 USD'
input:
  runs: ['2026-11-17T06:00-04:00', '2026-11-18T06:00-04:00']
steps:
  - 'Ejecutar el job en ambos instantes'
expected_result:
  - 'Un SubscriptionTrialEnding.v1 para 2026-11-20 con firstChargePrice 99.99 USD'
  - 'La corrida del 18 no publica otro'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-028 — El recordatorio de fin de trial se publica una sola vez con el precio del primer cobro

## Intención

Evitar el cobro sorpresa al terminar el trial (SM-07).

## Escenario

```gherkin
Dado "CloudDrive" en trial hasta 2026-11-20
Cuando la evaluación corre el 2026-11-17
Entonces se publica el aviso de fin de trial con 99.99 USD
  Y el 2026-11-18 no se publica otro
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
