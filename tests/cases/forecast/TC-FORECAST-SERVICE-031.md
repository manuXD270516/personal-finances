---
id: TC-FORECAST-SERVICE-031
title: "Un VIEWER consulta el pronóstico vigente con horizonte 3"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Consulta del pronóstico vigente"
scenario: "VIEWER consulta el pronóstico"
requirement_status: provisional
fr: ["FR-FORECAST-001","FR-FORECAST-002"]
nfr: ["NFR-SEC-003"]
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["read"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un VIEWER consulta el pronóstico vigente con horizonte 3"
expected_result:
  - "recibe las series con sus 3 primeros periodos pronosticados y la preparación de datos de cada una"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-031 — Un VIEWER consulta el pronóstico vigente con horizonte 3

## Intención

Verifica el scenario "VIEWER consulta el pronóstico" del requirement "Consulta del pronóstico vigente" de `forecast/expense-forecasting` (FR-FORECAST-001, FR-FORECAST-002, NFR-SEC-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un VIEWER consulta el pronóstico vigente con horizonte 3
Entonces recibe las series con sus 3 primeros periodos pronosticados y la preparación de datos de cada una
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
