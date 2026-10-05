---
id: TC-NOTIFICATIONS-INAPP-005
title: 'La notificación enlaza a la línea de presupuesto o al plan si la línea ya no existe'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Enlace al recurso de origen'
scenario: 'Enlace a la línea de presupuesto'
requirement_status: provisional
fr: ['FR-NOTIFY-001']
nfr: []
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['notifications', 'deep-link', 'ui']
error_code: null
preconditions:
  - 'Workspace "W1 Personal Demo" con moneda base BOB y TZ America/La_Paz (FixedClock)'
  - 'Notificación de umbral de "Restaurantes" en "2026-11"'
input:
  caseA: 'línea existente'
  caseB: 'línea quitada del plan antes de abrir'
steps:
  - 'Abrir la notificación con la línea existente'
  - 'Quitar la línea y abrir otra notificación equivalente'
expected_result:
  - 'Caso A: el plan de "2026-11" con "Restaurantes" resaltada'
  - 'Caso B: el plan de "2026-11" con el aviso de que la línea ya no existe'
created: 2026-10-05
updated: 2026-10-05
---

# TC-NOTIFICATIONS-INAPP-005 — La notificación enlaza a la línea de presupuesto o al plan si la línea ya no existe

## Intención

FR-NOTIFY-001: enlace al recurso origen con degradación segura.

## Escenario

```gherkin
Dado una notificación de umbral de "Restaurantes"
Cuando la abro
Entonces veo el plan de "2026-11" con "Restaurantes" resaltada
Cuando la línea fue quitada
Entonces veo el plan con el aviso de que ya no existe
```

## Notas

- Cubre también el scenario "Línea eliminada después".
