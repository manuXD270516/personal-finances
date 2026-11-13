---
id: TC-FORECAST-SERVICE-019
title: "Una categoría sin gasto en un periodo con actividad cuenta cero"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Huecos en la historia"
scenario: "Categoría sin gasto en un periodo"
requirement_status: provisional
fr: ["FR-FORECAST-005"]
nfr: []
invariants: []
priority: medium
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
  - "\"Restaurantes\" no tiene gasto en 2026-08 pero el workspace sí tiene transacciones ese periodo"
expected_result:
  - "la serie de \"Restaurantes\" tiene 0.00 BOB en 2026-08"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-019 — Una categoría sin gasto en un periodo con actividad cuenta cero

## Intención

Verifica el scenario "Categoría sin gasto en un periodo" del requirement "Huecos en la historia" de `forecast/expense-forecasting` (FR-FORECAST-005).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando "Restaurantes" no tiene gasto en 2026-08 pero el workspace sí tiene transacciones ese periodo
Entonces la serie de "Restaurantes" tiene 0.00 BOB en 2026-08
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
