---
id: TC-NOTIFICATIONS-BUDGETRISK-004
title: "El email de riesgo de presupuesto sin opt-in no lleva montos ni nombres"
spec: notifications/alerts
related_specs: []
requirement: "Emails de riesgo de presupuesto sin montos salvo opt-in"
scenario: "Email sin opt-in"
requirement_status: provisional
fr: ["FR-NOTIFY-006"]
nfr: ["NFR-COMP-001"]
invariants: []
priority: high
type: security
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["notifications","budget-risk","privacy"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; pronósticos deshabilitados salvo que el escenario diga otro"
input: {}
steps:
  - "el OWNER activó el email del tipo riesgo de presupuesto sin opt-in de detalles"
  - "\"Restaurantes\" pasa a riesgo LIKELY con proyección 840.00 BOB"
expected_result:
  - "el email indica un presupuesto en riesgo en 2026-11 con exceso estimado el 22/11/2026 y el enlace al plan"
  - "el email no contiene 840.00, 600.00 ni \"Restaurantes\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-NOTIFICATIONS-BUDGETRISK-004 — El email de riesgo de presupuesto sin opt-in no lleva montos ni nombres

## Intención

Verifica el scenario "Email sin opt-in" del requirement "Emails de riesgo de presupuesto sin montos salvo opt-in" de `notifications/alerts` (FR-NOTIFY-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando el OWNER activó el email del tipo riesgo de presupuesto sin opt-in de detalles
Y "Restaurantes" pasa a riesgo LIKELY con proyección 840.00 BOB
Entonces el email indica un presupuesto en riesgo en 2026-11 con exceso estimado el 22/11/2026 y el enlace al plan
Y el email no contiene 840.00, 600.00 ni "Restaurantes"
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
