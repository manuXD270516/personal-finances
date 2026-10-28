---
id: TC-NOTIFICATIONS-FX-021
title: "Las muestras posteriores del grupo no envían otro email"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Email único por grupo de tasas retenidas"
scenario: "Muestras posteriores sin otro email"
requirement_status: confirmed
fr: ["FR-NOTIFY-005", "FR-NOTIFY-006"]
nfr: []
invariants: ["INV-028"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/notifications/src/application/fx-rate-email.test.ts
  - apps/api/test/events/notifications.int.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["notifications", "fx", "email", "grouping"]
error_code: null
preconditions:
  - "OWNER con email activo; SMTP de prueba (Mailpit)"
  - "Grupo de USDT/BOB con 3 muestras pendientes"
input: {"from": 3, "to": 8}
steps:
  - "Correr dos ciclos que llevan el grupo a 8 muestras pendientes"
  - "Contar entregas de email y emails en Mailpit para el OWNER"
expected_result:
  - "Hay una sola entrega de email y un solo email del grupo"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-021 — Las muestras posteriores del grupo no envían otro email

## Intención

El refresco del aviso nunca programa email.

## Escenario

```gherkin
Dado el grupo de USDT/BOB con 3 pendientes
Cuando pasa a 8 en dos ciclos
Entonces el OWNER recibió un solo email
```

## Notas

- Change: `refine-rate-anomaly-alert-grouping`.
- Con Mailpit (2026-10-27, tarea 4.4): `apps/api/test/events/notifications.int.test.ts` usa el puerto de entrada real de NOTIFY sobre PostgreSQL real, el despachador real y SMTP real contra un Mailpit propio de Testcontainers: las muestras 5 y 8 solo actualizan el aviso: una entrega por destinatario y un único email en Mailpit para el OWNER (y otro para el EDITOR).
