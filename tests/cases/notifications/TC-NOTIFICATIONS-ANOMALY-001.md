---
id: TC-NOTIFICATIONS-ANOMALY-001
title: "Sin activar el tipo no se notifica ningún gasto atípico"
spec: notifications/alerts
related_specs: []
requirement: "Aviso de gastos atípicos desactivado por omisión"
scenario: "Sin activar el tipo"
requirement_status: provisional
fr: ["FR-FORECAST-010","FR-NOTIFY-004","FR-NOTIFY-003"]
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["notifications","anomalies"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el OWNER no cambió sus preferencias"
  - "la pasada del 2026-11-13 marca dos gastos atípicos nuevos"
expected_result:
  - "el OWNER no recibe ninguna notificación ni email"
  - "los dos gastos figuran en la lista"
created: 2026-11-25
updated: 2026-11-25
---

# TC-NOTIFICATIONS-ANOMALY-001 — Sin activar el tipo no se notifica ningún gasto atípico

## Intención

Verifica el scenario "Sin activar el tipo" del requirement "Aviso de gastos atípicos desactivado por omisión" de `notifications/alerts` (FR-FORECAST-010, FR-NOTIFY-004, FR-NOTIFY-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el OWNER no cambió sus preferencias
Y la pasada del 2026-11-13 marca dos gastos atípicos nuevos
Entonces el OWNER no recibe ninguna notificación ni email
Y los dos gastos figuran en la lista
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
