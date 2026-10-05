---
id: TC-NOTIFICATIONS-EMAIL-007
title: 'Con el canal email deshabilitado la entrega queda suprimida sin error'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Canal email deshabilitado por entorno'
scenario: 'Email deshabilitado'
requirement_status: provisional
fr: ['FR-NOTIFY-002']
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['notifications', 'email', 'config']
error_code: null
preconditions:
  - 'OWNER con locale es-BO, email verificado y preferencias por defecto'
  - 'EMAIL_DRIVER=none'
input:
  event: 'Evento planning.BudgetThresholdReached.v1: "Restaurantes", periodo "2026-11", threshold "90", alsoCrossed ["50","75"], reference 600.00 BOB, actual 550.00 BOB'
steps:
  - 'Procesar el evento y el despacho'
expected_result:
  - 'Notificación in-app UNREAD'
  - 'Entrega por email SUPPRESSED con motivo CHANNEL_DISABLED, sin reintentos'
created: 2026-10-05
updated: 2026-10-05
---

# TC-NOTIFICATIONS-EMAIL-007 — Con el canal email deshabilitado la entrega queda suprimida sin error

## Intención

Producción arranca con email deshabilitado hasta elegir proveedor (pregunta 1).

## Escenario

```gherkin
Dado el canal email deshabilitado en el entorno
Cuando se publica el umbral 90 %
Entonces la notificación in-app existe y la entrega por email queda suprimida
```

## Notas

