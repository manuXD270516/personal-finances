---
id: TC-DEBT-CARD-037
title: 'Notificaciones de tarjeta en el idioma del destinatario'
spec: notifications/alerts
related_specs: ['debt/credit-cards']
requirement: 'Idioma de las notificaciones de tarjeta'
scenario: 'Destinatario en inglés'
requirement_status: confirmed
fr: ['FR-NOTIFY-002', 'FR-NOTIFY-004']
nfr: []
invariants: []
priority: medium
type: unit
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/notifications/src/domain/card-notifications.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['notifications', 'i18n']
error_code: null
preconditions:
  - 'EDITOR con locale en-US'
input:
  type: 'CARD_PAYMENT_DUE'
  dueDate: '2026-11-15'
steps:
  - 'Renderizar la notificación'
expected_result:
  - 'Texto en inglés con la fecha en formato inglés'
  - 'Español por defecto si el locale no es soportado'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-037 — Notificaciones de tarjeta en el idioma del destinatario

## Intención

i18n es/en/pt de los tipos nuevos.

## Escenario

```gherkin
Dado un EDITOR en inglés
Cuando recibe el vencimiento de "Visa Oro" del 2026-11-15
Entonces el texto está en inglés
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
