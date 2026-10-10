---
id: TC-COMMITMENTS-SUBS-009
title: 'Cancelar durante el trial deja la suscripción sin ningún cargo esperado ni transacción'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Período de prueba y su fin'
scenario: 'Cancelación durante el trial'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-012', 'FR-COMMITMENTS-017']
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'trial', 'cancel']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"CloudDrive" en TRIAL hasta 2026-11-20 con ocurrencia generada del 2026-11-20'
  - 'Hoy 2026-11-10'
input:
  command: 'cancel'
  effectiveOn: '2026-11-10'
steps:
  - 'Cancelar "CloudDrive"'
expected_result:
  - '"CloudDrive" CANCELLED con fecha 2026-11-10'
  - 'La ocurrencia del 2026-11-20 queda CANCELLED (ENDED) y la definición está finalizada'
  - 'No hay transacciones de "CloudDrive"'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-009 — Cancelar durante el trial deja la suscripción sin ningún cargo esperado ni transacción

## Intención

Cancelar el trial a tiempo es el caso más común de "pago sorpresa" evitado (SM-07).

## Escenario

```gherkin
Dado "CloudDrive" en trial con cargo esperado el 2026-11-20
Cuando la cancelo el 2026-11-10
Entonces queda cancelada
  Y no queda ningún cargo esperado pendiente ni transacción
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
