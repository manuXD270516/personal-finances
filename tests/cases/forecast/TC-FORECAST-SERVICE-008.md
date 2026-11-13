---
id: TC-FORECAST-SERVICE-008
title: "El trabajo diario crea una corrida cuando termina un periodo nuevo"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Corridas programadas sin consumidores nuevos"
scenario: "Periodo nuevo terminado"
requirement_status: provisional
fr: ["FR-FORECAST-001"]
nfr: ["NFR-PERF-012"]
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["scheduler"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la última corrida completada es del 2026-10-03 con el periodo 2026-09 como último terminado y el 2026-11-01 termina el periodo 2026-10"
expected_result:
  - "el trabajo del 2026-11-01 crea una corrida programada para el workspace"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-008 — El trabajo diario crea una corrida cuando termina un periodo nuevo

## Intención

Verifica el scenario "Periodo nuevo terminado" del requirement "Corridas programadas sin consumidores nuevos" de `forecast/expense-forecasting` (FR-FORECAST-001, NFR-PERF-012).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la última corrida completada es del 2026-10-03 con el periodo 2026-09 como último terminado y el 2026-11-01 termina el periodo 2026-10
Entonces el trabajo del 2026-11-01 crea una corrida programada para el workspace
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
