---
id: TC-FORECAST-SERVICE-016
title: "Una serie con 8 periodos admite modelos estadísticos"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Preparación de datos por serie"
scenario: "Historia de 8 periodos"
requirement_status: provisional
fr: ["FR-FORECAST-005"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["readiness"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el gasto total tiene datos en los periodos 2026-03 a 2026-10"
expected_result:
  - "su serie admite modelos estadísticos"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-016 — Una serie con 8 periodos admite modelos estadísticos

## Intención

Verifica el scenario "Historia de 8 periodos" del requirement "Preparación de datos por serie" de `forecast/expense-forecasting` (FR-FORECAST-005).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el gasto total tiene datos en los periodos 2026-03 a 2026-10
Entonces su serie admite modelos estadísticos
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
