---
id: TC-NOTIFICATIONS-BUDGETRISK-005
title: "El aviso de riesgo de presupuesto sale en portugués"
spec: notifications/alerts
related_specs: []
requirement: "Emails de riesgo de presupuesto sin montos salvo opt-in"
scenario: "Notificación en portugués"
requirement_status: provisional
fr: ["FR-NOTIFY-002"]
nfr: ["NFR-USAB-001"]
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["notifications","budget-risk","i18n"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; pronósticos deshabilitados salvo que el escenario diga otro"
input: {}
steps:
  - "el OWNER tiene locale \"pt-BR\" y activó el tipo in-app y por email"
  - "recibe el riesgo de \"Restaurantes\""
expected_result:
  - "la notificación y el email están en portugués con la fecha 22/11/2026"
created: 2026-11-25
updated: 2026-11-25
---

# TC-NOTIFICATIONS-BUDGETRISK-005 — El aviso de riesgo de presupuesto sale en portugués

## Intención

Verifica el scenario "Notificación en portugués" del requirement "Emails de riesgo de presupuesto sin montos salvo opt-in" de `notifications/alerts` (FR-NOTIFY-002).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando el OWNER tiene locale "pt-BR" y activó el tipo in-app y por email
Y recibe el riesgo de "Restaurantes"
Entonces la notificación y el email están en portugués con la fecha 22/11/2026
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
