---
id: TC-FORECAST-SERVICE-021
title: "La petición al servicio no contiene nombres ni identificadores del workspace"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Datos mínimos enviados al servicio de pronósticos"
scenario: "Petición sin datos identificables"
requirement_status: provisional
fr: ["FR-FORECAST-006"]
nfr: ["NFR-COMP-001","NFR-COMP-002"]
invariants: []
priority: critical
type: security
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["privacy"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "se arma la petición de la corrida \"R2\" con la serie de \"Restaurantes\""
expected_result:
  - "la serie viaja con una referencia opaca como \"s7\" y sus montos por periodo, sin el nombre ni el identificador de la categoría"
  - "la petición no contiene el identificador del workspace"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-021 — La petición al servicio no contiene nombres ni identificadores del workspace

## Intención

Verifica el scenario "Petición sin datos identificables" del requirement "Datos mínimos enviados al servicio de pronósticos" de `forecast/expense-forecasting` (NFR-COMP-001, NFR-COMP-002, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando se arma la petición de la corrida "R2" con la serie de "Restaurantes"
Entonces la serie viaja con una referencia opaca como "s7" y sus montos por periodo, sin el nombre ni el identificador de la categoría
  Y la petición no contiene el identificador del workspace
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
