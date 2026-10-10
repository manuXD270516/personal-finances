---
id: TC-COMMITMENTS-SUBS-008
title: 'Una suscripción en trial pasa a activa una sola vez al llegar el fin de trial en La Paz'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Período de prueba y su fin'
scenario: 'Trial que termina'
requirement_status: provisional
fr: ['FR-COMMITMENTS-012']
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['subscriptions', 'trial', 'timezone']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"CloudDrive" 99.99 USD anual registrada el 2026-10-20 con fin de trial y primera renovación 2026-11-20'
input:
  clock: ['2026-11-19T23:30-04:00', '2026-11-20T00:05-04:00', '2026-11-20T01:05-04:00']
steps:
  - 'Ejecutar el job commitments.subscription-daily en cada instante (TZ del proceso UTC y America/La_Paz)'
expected_result:
  - 'A las 23:30 del 19 sigue TRIAL'
  - 'A las 00:05 del 20 pasa a ACTIVE con próxima renovación 2026-11-20 por 99.99 USD'
  - 'La corrida de las 01:05 no registra otra transición'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-SUBS-008 — Una suscripción en trial pasa a activa una sola vez al llegar el fin de trial en La Paz

## Intención

RISK-020: el fin de trial depende de "hoy" en la zona del workspace, no del servidor.

## Escenario

```gherkin
Dado "CloudDrive" en trial hasta 2026-11-20
Cuando el reloj llega al 2026-11-20 00:05 en La Paz
Entonces "CloudDrive" está activa
  Y su próxima renovación es 2026-11-20 por 99.99 USD
```

## Notas

- Mismo test: primera renovación 2026-11-01 con fin de trial 2026-11-20 ⇒ VALIDATION_FAILED.
- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
