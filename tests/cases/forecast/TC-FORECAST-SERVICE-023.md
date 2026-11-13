---
id: TC-FORECAST-SERVICE-023
title: "Una serie con el intervalo desordenado se descarta y las demás se publican"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Resultado validado antes de publicarse"
scenario: "Intervalo desordenado"
requirement_status: provisional
fr: ["FR-FORECAST-002","FR-FORECAST-006"]
nfr: []
invariants: []
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["validation"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el servicio devuelve para \"Restaurantes\" en 2026-11 un valor esperado de 900.00 BOB con intervalo del 80 % de 950.00 BOB a 1100.00 BOB"
expected_result:
  - "la serie de \"Restaurantes\" se descarta por salida inválida"
  - "las demás series de la corrida se publican"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-023 — Una serie con el intervalo desordenado se descarta y las demás se publican

## Intención

Verifica el scenario "Intervalo desordenado" del requirement "Resultado validado antes de publicarse" de `forecast/expense-forecasting` (FR-FORECAST-002, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el servicio devuelve para "Restaurantes" en 2026-11 un valor esperado de 900.00 BOB con intervalo del 80 % de 950.00 BOB a 1100.00 BOB
Entonces la serie de "Restaurantes" se descarta por salida inválida
  Y las demás series de la corrida se publican
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
