---
id: TC-NOTIFICATIONS-I18N-001
title: 'Las notificaciones usan el idioma del locale en inglés y portugués'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Idioma de la notificación según el usuario'
scenario: 'Usuario en inglés'
requirement_status: confirmed
fr: ['FR-NOTIFY-002']
nfr: ['NFR-USAB-001', 'NFR-USAB-002']
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['notifications', 'i18n']
error_code: null
preconditions:
  - 'OWNER con locale en-US y EDITOR con locale pt-BR, ambos con email activado y sin opt-in'
  - 'Mailpit'
input:
  event: 'Evento planning.BudgetThresholdReached.v1: "Restaurantes", periodo "2026-11", threshold "90", alsoCrossed ["50","75"], reference 600.00 BOB, actual 550.00 BOB'
steps:
  - 'Procesar el evento y despachar los emails'
  - 'Listar las notificaciones in-app de cada uno'
expected_result:
  - 'Asunto del OWNER: "You have a budget alert"; in-app en inglés'
  - 'Asunto del EDITOR: "Você tem um alerta de orçamento"; in-app en portugués'
created: 2026-10-05
updated: 2026-10-08
---

# TC-NOTIFICATIONS-I18N-001 — Las notificaciones usan el idioma del locale en inglés y portugués

## Intención

NFR-USAB-001: i18n preparada para inglés y portugués.

## Escenario

```gherkin
Dado un OWNER en en-US y un EDITOR en pt-BR
Cuando se publica el umbral 90 %
Entonces el OWNER recibe "You have a budget alert"
  Y el EDITOR recibe "Você tem um alerta de orçamento"
```

## Notas

- Cubre también el scenario "Usuario en portugués".
