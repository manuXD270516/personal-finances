---
id: TC-NOTIFICATIONS-BUDGETRISK-002
title: "El riesgo que baja y vuelve a subir no se avisa otra vez"
spec: notifications/alerts
related_specs: []
requirement: "Aviso de riesgo de exceder un presupuesto desactivado por omisión"
scenario: "Riesgo que baja y vuelve a subir"
requirement_status: provisional
fr: ["FR-NOTIFY-005","FR-NOTIFY-004"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["notifications","budget-risk","idempotency"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; pronósticos deshabilitados salvo que el escenario diga otro"
input: {}
steps:
  - "el OWNER ya recibió el aviso de \"Restaurantes\" en 2026-11"
  - "al día siguiente un reembolso deja la línea en UNLIKELY y dos días después vuelve a LIKELY; la pasada horaria corre varias veces"
expected_result:
  - "no se crea una notificación nueva de \"Restaurantes\" en 2026-11"
  - "reporting.budget_overrun_notice tiene una sola fila para esa línea y periodo"
created: 2026-11-25
updated: 2026-11-25
---

# TC-NOTIFICATIONS-BUDGETRISK-002 — El riesgo que baja y vuelve a subir no se avisa otra vez

## Intención

Verifica el scenario "Riesgo que baja y vuelve a subir" del requirement "Aviso de riesgo de exceder un presupuesto desactivado por omisión" de `notifications/alerts` (FR-NOTIFY-005, FR-NOTIFY-004).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando el OWNER ya recibió el aviso de "Restaurantes" en 2026-11
Y al día siguiente un reembolso deja la línea en UNLIKELY y dos días después vuelve a LIKELY; la pasada horaria corre varias veces
Entonces no se crea una notificación nueva de "Restaurantes" en 2026-11
Y reporting.budget_overrun_notice tiene una sola fila para esa línea y periodo
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
