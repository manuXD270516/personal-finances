---
id: TC-FORECAST-SERVICE-025
title: "El punto publicado informa valor, intervalos, referencia, modelo, historia y conjunto de datos"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Contenido de cada pronóstico publicado"
scenario: "Punto del gasto total"
requirement_status: provisional
fr: ["FR-FORECAST-002"]
nfr: []
invariants: []
priority: high
type: api
level: contract
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["contract"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la corrida \"R2\" del 2026-11-01 publica el gasto total de 2026-11 con historia de 2025-11 a 2026-10"
expected_result:
  - "el punto informa 2026-11, 1 periodo hacia adelante, valor esperado 4350.00 BOB, intervalo del 80 % de 3980.00 BOB a 4790.00 BOB, intervalo del 95 % de 3810.00 BOB a 5050.00 BOB, referencia \"promedio de 6 periodos\" de 4210.00 BOB, modelo y versión, historia de 2025-11 a 2026-10, conjunto de datos e instante de generación"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-025 — El punto publicado informa valor, intervalos, referencia, modelo, historia y conjunto de datos

## Intención

Verifica el scenario "Punto del gasto total" del requirement "Contenido de cada pronóstico publicado" de `forecast/expense-forecasting` (FR-FORECAST-002).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la corrida "R2" del 2026-11-01 publica el gasto total de 2026-11 con historia de 2025-11 a 2026-10
Entonces el punto informa 2026-11, 1 periodo hacia adelante, valor esperado 4350.00 BOB, intervalo del 80 % de 3980.00 BOB a 4790.00 BOB, intervalo del 95 % de 3810.00 BOB a 5050.00 BOB, referencia "promedio de 6 periodos" de 4210.00 BOB, modelo y versión, historia de 2025-11 a 2026-10, conjunto de datos e instante de generación
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
