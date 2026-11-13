---
id: TC-FORECAST-ACCURACY-007
title: "Tres periodos con error escalado alto marcan pérdida de precisión sin notificar"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Indicador de pérdida de precisión"
scenario: "Tres periodos con error escalado alto"
requirement_status: provisional
fr: ["FR-FORECAST-009"]
nfr: []
invariants: []
priority: low
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["accuracy","drift"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "\"Supermercado\" tiene error escalado 1.35, 1.28 y 1.41 en sus 3 últimos periodos evaluados"
expected_result:
  - "la vista indica que el pronóstico de \"Supermercado\" perdió precisión y no se crea ninguna notificación"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-ACCURACY-007 — Tres periodos con error escalado alto marcan pérdida de precisión sin notificar

## Intención

Verifica el scenario "Tres periodos con error escalado alto" del requirement "Indicador de pérdida de precisión" de `forecast/expense-forecasting` (FR-FORECAST-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando "Supermercado" tiene error escalado 1.35, 1.28 y 1.41 en sus 3 últimos periodos evaluados
Entonces la vista indica que el pronóstico de "Supermercado" perdió precisión y no se crea ninguna notificación
```

## Notas

- Change `add-forecast-accuracy` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
