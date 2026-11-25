---
id: TC-NOTIFICATIONS-ANOMALY-003
title: "Repetir la pasada no duplica la notificación"
spec: notifications/alerts
related_specs: []
requirement: "Aviso de gastos atípicos desactivado por omisión"
scenario: "Pasada repetida"
requirement_status: confirmed
fr: ["FR-NOTIFY-005","FR-NOTIFY-004"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/application/spending-anomalies.test.ts
  - packages/contexts/notifications/src/application/spending-anomaly-notifications.test.ts
  - packages/contexts/notifications/src/domain/spending-anomaly-notifications.test.ts
  - packages/contexts/notifications/test/integration/notification-intake.int.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["notifications","anomalies","idempotency"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el OWNER activó el tipo gasto atípico"
  - "el trabajo diario del 2026-11-13 corre dos veces"
expected_result:
  - "el OWNER tiene una sola notificación de esa pasada"
created: 2026-11-25
updated: 2026-11-25
---

# TC-NOTIFICATIONS-ANOMALY-003 — Repetir la pasada no duplica la notificación

## Intención

Verifica el scenario "Pasada repetida" del requirement "Aviso de gastos atípicos desactivado por omisión" de `notifications/alerts` (FR-NOTIFY-005, FR-NOTIFY-004).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el OWNER activó el tipo gasto atípico
Y el trabajo diario del 2026-11-13 corre dos veces
Entonces el OWNER tiene una sola notificación de esa pasada
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
