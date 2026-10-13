---
id: TC-NOTIFICATIONS-FX-022
title: "El email diferido por horario de silencio muestra el estado del grupo al enviarse"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Email único por grupo de tasas retenidas"
scenario: "Email diferido con el estado al enviarse"
requirement_status: provisional
fr: ["FR-NOTIFY-006"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["notifications", "fx", "email", "quiet-hours"]
error_code: null
preconditions:
  - "OWNER con opt-in de detalles y horario de silencio de 22:00 a 07:00 en America/La_Paz; SMTP de prueba (Mailpit); FixedClock"
input: {"createdAt": "2026-10-14T03:30:00Z", "refreshedAt": "2026-10-14T05:00:00Z", "sentAt": "2026-10-14T11:00:00Z"}
steps:
  - "Crear el aviso de USDT/BOB con 3 pendientes a las 03:30Z"
  - "Retener dos muestras más a las 05:00Z"
  - "Avanzar el reloj a las 11:00Z y correr la entrega"
expected_result:
  - "Se envía un único email a las 11:00Z (07:00 en La Paz)"
  - "El email muestra 5 muestras pendientes"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-022 — El email diferido por horario de silencio muestra el estado del grupo al enviarse

## Intención

El email se renderiza desde la notificación vigente al enviarse.

## Escenario

```gherkin
Dado el OWNER con opt-in y silencio de 22:00 a 07:00
Cuando el grupo crece durante el silencio
Entonces el email de las 07:00 muestra el estado vigente
```

## Notas

- Change: `refine-rate-anomaly-alert-grouping` (borrador).
