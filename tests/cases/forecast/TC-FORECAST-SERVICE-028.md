---
id: TC-FORECAST-SERVICE-028
title: "La corrida del conjunto Large con el servicio real termina en 300 s o menos"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Rendimiento de una corrida"
scenario: "Benchmark nocturno de la corrida"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-012"]
invariants: []
priority: medium
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 8
tags: ["perf","NFR-PERF-012"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el benchmark nocturno ejecuta una corrida sobre el conjunto de datos de rendimiento con el servicio real"
expected_result:
  - "la corrida se completa en 300 segundos o menos"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-028 — La corrida del conjunto Large con el servicio real termina en 300 s o menos

## Intención

Verifica el scenario "Benchmark nocturno de la corrida" del requirement "Rendimiento de una corrida" de `forecast/expense-forecasting` (NFR-PERF-012).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el benchmark nocturno ejecuta una corrida sobre el conjunto de datos de rendimiento con el servicio real
Entonces la corrida se completa en 300 segundos o menos
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
