---
id: TC-NOTIFICATIONS-EMAIL-003
title: 'El enlace del email exige sesión y no lleva tokens ni datos financieros'
spec: notifications/alerts
related_specs: ['planning/budgets', 'identity/authentication']
requirement: 'Emails enlazan a la app autenticada'
scenario: 'Enlace sin sesión'
requirement_status: provisional
fr: ['FR-NOTIFY-006']
nfr: ['NFR-SEC-001']
invariants: []
priority: critical
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['notifications', 'email', 'security']
error_code: null
preconditions:
  - 'Stack pfos-e2e con Mailpit y Keycloak'
  - 'Email de umbral recibido por el OWNER'
input:
  link: 'APP_PUBLIC_URL/notificaciones/{notificationId}'
steps:
  - 'Abrir el enlace del email en un navegador sin sesión'
  - 'Iniciar sesión'
expected_result:
  - 'La app pide iniciar sesión y luego muestra la notificación'
  - 'El enlace solo contiene la ruta y el id opaco (sin query de tokens, montos ni nombres)'
created: 2026-10-05
updated: 2026-10-05
---

# TC-NOTIFICATIONS-EMAIL-003 — El enlace del email exige sesión y no lleva tokens ni datos financieros

## Intención

FR-NOTIFY-006: sin magic links; la sesión la gestiona el BFF.

## Escenario

```gherkin
Dado el email de umbral recibido
Cuando abro su enlace sin sesión
Entonces la app pide iniciar sesión y luego muestra la notificación
```

## Notas

