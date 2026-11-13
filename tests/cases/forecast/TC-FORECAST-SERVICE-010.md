---
id: TC-FORECAST-SERVICE-010
title: "El worker arranca con la función habilitada sin consumidores ni conexiones nuevas"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Corridas programadas sin consumidores nuevos"
scenario: "Presupuesto de conexiones intacto"
requirement_status: provisional
fr: ["FR-FORECAST-001"]
nfr: ["NFR-PERF-012"]
invariants: []
priority: high
type: platform
level: container-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["connections","D249"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el worker arranca con la configuración de la plantilla del host y la función habilitada"
expected_result:
  - "la cantidad de consumidores y las conexiones validadas al arrancar son las mismas que sin la función"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-010 — El worker arranca con la función habilitada sin consumidores ni conexiones nuevas

## Intención

Verifica el scenario "Presupuesto de conexiones intacto" del requirement "Corridas programadas sin consumidores nuevos" de `forecast/expense-forecasting` (FR-FORECAST-001, NFR-PERF-012).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el worker arranca con la configuración de la plantilla del host y la función habilitada
Entonces la cantidad de consumidores y las conexiones validadas al arrancar son las mismas que sin la función
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
