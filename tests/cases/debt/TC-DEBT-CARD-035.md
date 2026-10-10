---
id: TC-DEBT-CARD-035
title: 'Notificación de utilización con el umbral más alto'
spec: notifications/alerts
related_specs: ['debt/credit-cards']
requirement: 'Notificación de utilización de la tarjeta'
scenario: 'Visa Oro al 85 %'
requirement_status: provisional
fr: ['FR-NOTIFY-004', 'FR-NOTIFY-005', 'FR-DEBT-015']
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['notifications', 'utilization']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Miembros OWNER y EDITOR'
input:
  event: 'CreditUtilizationThresholdReached.v1 threshold 80.00, alsoCrossed [30.00], utilization 85.00'
steps:
  - 'Procesar el hecho'
expected_result:
  - 'Una sola notificación WARNING "Visa Oro alcanzó el 80 % de su límite" por destinatario'
  - 'Email sin montos ni utilización salvo opt-in'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-035 — Notificación de utilización con el umbral más alto

## Intención

Un aviso por cruce, no uno por umbral.

## Escenario

```gherkin
Dado el hecho de umbral 80.00 % con 30.00 % también cruzado
Cuando NOTIFY lo procesa
Entonces cada destinatario recibe una sola notificación
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
