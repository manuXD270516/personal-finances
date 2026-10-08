---
id: TC-NOTIFICATIONS-EMAIL-004
title: 'En local el email de alerta se captura en Mailpit con el asunto en español'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Entrega por email'
scenario: 'Email capturado en local'
requirement_status: confirmed
fr: ['FR-NOTIFY-002']
nfr: []
invariants: []
priority: high
type: integration
level: container-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['notifications', 'email', 'mailpit']
error_code: null
preconditions:
  - 'OWNER con locale es-BO, email verificado y preferencias por defecto'
  - 'EMAIL_DRIVER=smtp, SMTP_HOST apuntando a Mailpit'
input:
  event: 'Evento planning.BudgetThresholdReached.v1: "Restaurantes", periodo "2026-11", threshold "90", alsoCrossed ["50","75"], reference 600.00 BOB, actual 550.00 BOB'
steps:
  - 'Procesar el evento y el job notifications.email-dispatch'
  - 'Consultar la API de Mailpit'
expected_result:
  - 'Un email para la dirección del OWNER con asunto "Tienes una alerta de presupuesto"'
  - 'La entrega queda SENT con provider_message_id'
  - 'Message-ID = <deliveryId@dominio de EMAIL_FROM>'
created: 2026-10-05
updated: 2026-10-08
---

# TC-NOTIFICATIONS-EMAIL-004 — En local el email de alerta se captura en Mailpit con el asunto en español

## Intención

FR-NOTIFY-002: canal email vía SMTP con Mailpit en local/CI, sin salir a internet.

## Escenario

```gherkin
Dado el OWNER con email activado en local
Cuando se publica el umbral 90 %
Entonces Mailpit contiene un email con asunto "Tienes una alerta de presupuesto"
```

## Notas

