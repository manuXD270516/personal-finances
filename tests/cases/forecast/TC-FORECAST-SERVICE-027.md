---
id: TC-FORECAST-SERVICE-027
title: "Un horizonte distinto de 1, 3, 6 o 12 se rechaza"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Horizonte de las series"
scenario: "Horizonte no admitido"
requirement_status: provisional
fr: ["FR-FORECAST-001"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["horizon"]
error_code: INVALID_FILTER
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "se consulta el pronóstico con horizonte 4"
expected_result:
  - "la consulta se rechaza con `INVALID_FILTER`"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-027 — Un horizonte distinto de 1, 3, 6 o 12 se rechaza

## Intención

Verifica el scenario "Horizonte no admitido" del requirement "Horizonte de las series" de `forecast/expense-forecasting` (FR-FORECAST-001).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando se consulta el pronóstico con horizonte 4
Entonces la consulta se rechaza con `INVALID_FILTER`
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
