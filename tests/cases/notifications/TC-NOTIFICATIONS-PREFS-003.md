---
id: TC-NOTIFICATIONS-PREFS-003
title: 'Las preferencias por defecto activan ambos canales sin detalles en el email'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Preferencias por tipo y canal'
scenario: null
requirement_status: confirmed
fr: ['FR-NOTIFY-003', 'FR-NOTIFY-006']
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/notifications.api.test.ts
  - apps/web/src/ui/notifications/notifications.test.tsx
  - packages/contexts/notifications/src/application/preferences.service.test.ts
  - packages/contexts/notifications/src/domain/preferences.test.ts
  - packages/contexts/notifications/test/integration/pg-notifications.int.test.ts
  - tests/e2e/specs/notifications.spec.ts
status: automated
regression_suite: false
phase: 2
tags: ['notifications', 'preferences', 'defaults']
error_code: null
preconditions:
  - 'Usuario sin preferencias guardadas'
input:
  request: 'GET notification-preferences'
steps:
  - 'Consultar las preferencias'
expected_result:
  - 'BUDGET_THRESHOLD y MONTH_CLOSE_PENDING con inApp true y email true'
  - 'includeDetailsInEmail false'
  - 'quietHours null'
created: 2026-10-05
updated: 2026-10-08
---

# TC-NOTIFICATIONS-PREFS-003 — Las preferencias por defecto activan ambos canales sin detalles en el email

## Intención

Defaults explícitos (design.md decisión 10, pregunta 2).

## Escenario

```gherkin
Dado un usuario sin preferencias guardadas
Cuando consulta sus preferencias
Entonces ambos canales están activos y la inclusión de detalles desactivada
```

## Notas

