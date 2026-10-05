---
id: TC-NOTIFICATIONS-I18N-002
title: 'Un locale sin traducción usa español y cambiar el locale traduce las existentes'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Idioma de la notificación según el usuario'
scenario: 'Locale sin traducción'
requirement_status: provisional
fr: ['FR-NOTIFY-002']
nfr: ['NFR-USAB-001']
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['notifications', 'i18n', 'fallback']
error_code: null
preconditions:
  - 'VIEWER con locale fr-FR con una notificación de umbral'
input:
  localeChange: 'fr-FR → en-US'
steps:
  - 'Listar las notificaciones del VIEWER'
  - 'Cambiar su locale a en-US y volver a listar'
expected_result:
  - 'Con fr-FR el texto está en español'
  - 'Con en-US la misma notificación se muestra en inglés'
created: 2026-10-05
updated: 2026-10-05
---

# TC-NOTIFICATIONS-I18N-002 — Un locale sin traducción usa español y cambiar el locale traduce las existentes

## Intención

Respaldo es y render en lectura (design.md decisión 3).

## Escenario

```gherkin
Dado un VIEWER con locale fr-FR
Cuando lista sus notificaciones
Entonces las ve en español
Cuando cambia su locale a en-US
Entonces la misma notificación se muestra en inglés
```

## Notas

