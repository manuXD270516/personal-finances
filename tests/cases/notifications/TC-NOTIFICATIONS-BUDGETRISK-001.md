---
id: TC-NOTIFICATIONS-BUDGETRISK-001
title: "Solo quien activó el tipo recibe el aviso de riesgo de presupuesto"
spec: notifications/alerts
related_specs: []
requirement: "Aviso de riesgo de exceder un presupuesto desactivado por omisión"
scenario: "Tipo activado"
requirement_status: provisional
fr: ["FR-REPORTING-020","FR-NOTIFY-004","FR-NOTIFY-003"]
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
tags: ["notifications","budget-risk"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; pronósticos deshabilitados salvo que el escenario diga otro"
input: {}
steps:
  - "el OWNER activó el tipo riesgo de presupuesto in-app y el EDITOR no"
  - "la pasada de reporting.cash-flow-watch del 2026-11-10 encuentra a \"Restaurantes\" en riesgo LIKELY con fecha 2026-11-22"
expected_result:
  - "el OWNER recibe una notificación de riesgo de \"Restaurantes\" en 2026-11 con proyección 840.00 de 600.00 BOB y fecha 22/11/2026"
  - "el EDITOR no la recibe"
created: 2026-11-25
updated: 2026-11-25
---

# TC-NOTIFICATIONS-BUDGETRISK-001 — Solo quien activó el tipo recibe el aviso de riesgo de presupuesto

## Intención

Verifica el scenario "Tipo activado" del requirement "Aviso de riesgo de exceder un presupuesto desactivado por omisión" de `notifications/alerts` (FR-REPORTING-020, FR-NOTIFY-004, FR-NOTIFY-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando el OWNER activó el tipo riesgo de presupuesto in-app y el EDITOR no
Y la pasada de reporting.cash-flow-watch del 2026-11-10 encuentra a "Restaurantes" en riesgo LIKELY con fecha 2026-11-22
Entonces el OWNER recibe una notificación de riesgo de "Restaurantes" en 2026-11 con proyección 840.00 de 600.00 BOB y fecha 22/11/2026
Y el EDITOR no la recibe
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
