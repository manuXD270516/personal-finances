---
id: TC-COMMITMENTS-SUBS-033
title: 'El email de renovación no incluye provider, montos ni cuenta salvo opt-in de detalles'
spec: notifications/alerts
related_specs: ['commitments/subscriptions']
requirement: 'Emails de suscripciones sin detalles salvo opt-in'
scenario: 'Email de renovación sin detalles'
requirement_status: provisional
fr: ['FR-NOTIFY-006']
nfr: ['NFR-COMP-001']
invariants: []
priority: critical
type: integration
level: container-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['notifications', 'email', 'privacy', 'subscriptions']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'OWNER con email verificado y canal email activado'
  - 'Mailpit en el stack local/CI'
input:
  event: 'SubscriptionRenewalUpcoming.v1 Streamly 2026-11-15 10.99 USD Visa USD daysBefore 3'
  optIn: ['false', 'true']
steps:
  - 'Entregar el hecho sin opt-in y leer el email en Mailpit'
  - 'Activar el opt-in de detalles y repetir con otra renovación'
expected_result:
  - 'Sin opt-in: el email dice que una suscripción se renueva en 3 días y no contiene "Streamly", "10.99", "USD" ni "Visa USD"'
  - 'Con opt-in: contiene "Streamly", 15/11/2026 y 10.99 USD'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-SUBS-033 — El email de renovación no incluye provider, montos ni cuenta salvo opt-in de detalles

## Intención

FR-NOTIFY-006: emails sin montos ni nombres salvo opt-in (RISK-010).

## Escenario

```gherkin
Dado el OWNER sin opt-in de detalles
Cuando recibe la renovación de "Streamly"
Entonces el email no contiene "Streamly", "10.99", "USD" ni "Visa USD"
```

## Notas

- Verificar también los tipos de fin de trial y cambio de precio con el mismo test parametrizado.
- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
