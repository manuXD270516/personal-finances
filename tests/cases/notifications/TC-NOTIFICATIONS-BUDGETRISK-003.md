---
id: TC-NOTIFICATIONS-BUDGETRISK-003
title: "Una línea que ya cruzó el 100 % no recibe aviso de riesgo"
spec: notifications/alerts
related_specs: []
requirement: "Aviso de riesgo de exceder un presupuesto desactivado por omisión"
scenario: "Umbral de 100 % ya cruzado"
requirement_status: confirmed
fr: ["FR-REPORTING-020","FR-NOTIFY-004"]
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/events/budget-risk.int.test.ts
  - packages/contexts/notifications/src/application/budget-risk-notifications.test.ts
  - packages/contexts/reporting/src/application/budget-risk.queries.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["notifications","budget-risk"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; pronósticos deshabilitados salvo que el escenario diga otro"
input: {}
steps:
  - "\"Restaurantes\" ya cruzó su umbral de 100 % en 2026-11 y el OWNER activó el tipo"
  - "corre la pasada horaria"
expected_result:
  - "no se crea notificación de riesgo de presupuesto para esa línea en ese periodo"
created: 2026-11-25
updated: 2026-11-25
---

# TC-NOTIFICATIONS-BUDGETRISK-003 — Una línea que ya cruzó el 100 % no recibe aviso de riesgo

## Intención

Verifica el scenario "Umbral de 100 % ya cruzado" del requirement "Aviso de riesgo de exceder un presupuesto desactivado por omisión" de `notifications/alerts` (FR-REPORTING-020, FR-NOTIFY-004).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando "Restaurantes" ya cruzó su umbral de 100 % en 2026-11 y el OWNER activó el tipo
Y corre la pasada horaria
Entonces no se crea notificación de riesgo de presupuesto para esa línea en ese periodo
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
