---
id: TC-NOTIFICATIONS-PREFS-002
title: 'El horario de silencio difiere el email hasta su fin sin demorar el in-app'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Horario de silencio difiere los emails'
scenario: 'Silencio de 22:00 a 07:00'
requirement_status: confirmed
fr: ['FR-NOTIFY-003']
nfr: ['NFR-USAB-004']
invariants: []
priority: medium
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['notifications', 'quiet-hours', 'timezone']
error_code: null
preconditions:
  - 'OWNER con zona America/La_Paz y silencio 22:00–07:00'
  - 'FixedClock 2026-11-12T23:15:00-04:00'
input:
  event: 'Evento planning.BudgetThresholdReached.v1: "Restaurantes", periodo "2026-11", threshold "90", alsoCrossed ["50","75"], reference 600.00 BOB, actual 550.00 BOB'
steps:
  - 'Procesar el evento'
  - 'Avanzar el reloj a 2026-11-13T07:00:00-04:00 y ejecutar el despacho'
expected_result:
  - 'La notificación in-app existe desde las 23:15'
  - 'La entrega por email queda PENDING con not_before 2026-11-13T11:00:00Z'
  - 'El email se envía a partir de las 07:00 del 13 (hora de La Paz)'
created: 2026-10-05
updated: 2026-10-08
---

# TC-NOTIFICATIONS-PREFS-002 — El horario de silencio difiere el email hasta su fin sin demorar el in-app

## Intención

FR-NOTIFY-003: silencio difiere, no descarta.

## Escenario

```gherkin
Dado silencio de 22:00 a 07:00 en La Paz
Cuando el umbral 90 % se publica el 2026-11-12 a las 23:15
Entonces la notificación in-app existe de inmediato
  Y el email se envía el 2026-11-13 desde las 07:00
```

## Notas

- PBT asociado: not_before nunca cae dentro del silencio.
