---
id: TC-NOTIFICATIONS-ANOMALY-002
title: "Con el tipo activado OWNER y EDITOR reciben una notificación por pasada"
spec: notifications/alerts
related_specs: []
requirement: "Aviso de gastos atípicos desactivado por omisión"
scenario: "Tipo activado"
requirement_status: confirmed
fr: ["FR-FORECAST-010","FR-NOTIFY-004"]
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/application/spending-anomalies.test.ts
  - packages/contexts/notifications/src/application/spending-anomaly-notifications.test.ts
  - packages/contexts/notifications/src/domain/spending-anomaly-notifications.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["notifications","anomalies"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el OWNER, el EDITOR y el VIEWER activaron el tipo gasto atípico in-app"
  - "la pasada del 2026-11-13 marca dos gastos atípicos nuevos"
expected_result:
  - "el OWNER y el EDITOR reciben una sola notificación cada uno con 2 gastos atípicos nuevos y el enlace a la lista"
  - "el VIEWER no la recibe"
created: 2026-11-25
updated: 2026-11-25
---

# TC-NOTIFICATIONS-ANOMALY-002 — Con el tipo activado OWNER y EDITOR reciben una notificación por pasada

## Intención

Verifica el scenario "Tipo activado" del requirement "Aviso de gastos atípicos desactivado por omisión" de `notifications/alerts` (FR-FORECAST-010, FR-NOTIFY-004).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el OWNER, el EDITOR y el VIEWER activaron el tipo gasto atípico in-app
Y la pasada del 2026-11-13 marca dos gastos atípicos nuevos
Entonces el OWNER y el EDITOR reciben una sola notificación cada uno con 2 gastos atípicos nuevos y el enlace a la lista
Y el VIEWER no la recibe
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
