---
id: TC-NOTIFICATIONS-FX-007
title: "Las preferencias por tipo y canal y el horario de silencio se aplican a las alertas de tasas"
spec: notifications/alerts
related_specs: []
requirement: "Emails de tasas sin valores salvo opt-in"
scenario: "Email de obsolescencia desactivado"
requirement_status: confirmed
fr: ["FR-NOTIFY-003", "FR-NOTIFY-006"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/notifications/src/application/fx-rate-email.test.ts
  - packages/contexts/notifications/src/application/notification-intake.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["notifications", "fx", "preferences"]
error_code: null
preconditions:
  - "EDITOR con email desactivado para FX_RATE_FEED_STALE; OWNER con silencio de 22:00 a 07:00"
input: {}
steps:
  - "Notificar una obsolescencia a las 23:15 hora de La Paz"
expected_result:
  - "El EDITOR tiene la notificación in-app y ningún email"
  - "El OWNER tiene la in-app desde las 23:15 y el email se envía desde las 07:00"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-007 — Las preferencias por tipo y canal y el horario de silencio se aplican a las alertas de tasas

## Intención

Los tipos nuevos usan las mismas preferencias que el resto (D235: email según preferencias).

## Escenario

```gherkin
Dado el email de obsolescencia desactivado para el EDITOR
Cuando se publica una obsolescencia
Entonces solo recibe la in-app
```

## Notas

