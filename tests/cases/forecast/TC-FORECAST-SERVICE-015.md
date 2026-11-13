---
id: TC-FORECAST-SERVICE-015
title: "Una serie con 2 periodos no se pronostica e informa los periodos faltantes"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Preparación de datos por serie"
scenario: "Historia de 2 periodos"
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
  - "la categoría \"Gimnasio\" tiene datos solo en 2026-09 y 2026-10"
expected_result:
  - "su serie no se pronostica e informa que falta 1 periodo para la estimación simple y 4 para un modelo"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-015 — Una serie con 2 periodos no se pronostica e informa los periodos faltantes

## Intención

Verifica el scenario "Historia de 2 periodos" del requirement "Preparación de datos por serie" de `forecast/expense-forecasting` (FR-FORECAST-005).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la categoría "Gimnasio" tiene datos solo en 2026-09 y 2026-10
Entonces su serie no se pronostica e informa que falta 1 periodo para la estimación simple y 4 para un modelo
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
