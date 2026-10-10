---
id: TC-COMMITMENTS-SUBS-031
title: 'El fin de trial próximo crea una notificación con provider, fecha y primer cobro'
spec: notifications/alerts
related_specs: ['commitments/subscriptions']
requirement: 'Notificación de fin de trial próximo'
scenario: 'Trial de CloudDrive'
requirement_status: confirmed
fr: ['FR-NOTIFY-004', 'FR-NOTIFY-001', 'FR-COMMITMENTS-016']
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/notifications/src/application/subscription-notifications.test.ts
  - packages/contexts/notifications/src/domain/subscription-notifications.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['notifications', 'subscriptions', 'trial']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'OWNER con locale es-BO'
input:
  event: 'commitments.SubscriptionTrialEnding.v1'
  provider: 'CloudDrive'
  trialEndsOn: '2026-11-20'
  firstChargePrice: '99.99 USD'
steps:
  - 'Entregar el hecho'
expected_result:
  - 'Notificación UNREAD SUBSCRIPTION_TRIAL_ENDING, severidad WARNING, texto "El trial de CloudDrive termina el 20/11/2026; primer cobro 99.99 USD"'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-031 — El fin de trial próximo crea una notificación con provider, fecha y primer cobro

## Intención

FR-NOTIFY-004: aviso de fin de trial (Phase 3).

## Escenario

```gherkin
Cuando se publica el fin de trial de "CloudDrive" del 2026-11-20
Entonces el OWNER ve "El trial de CloudDrive termina el 20/11/2026; primer cobro 99.99 USD"
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
