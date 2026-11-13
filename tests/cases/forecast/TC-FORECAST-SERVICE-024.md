---
id: TC-FORECAST-SERVICE-024
title: "Un valor que excede la escala de la moneda descarta la serie"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Resultado validado antes de publicarse"
scenario: "Escala de la moneda excedida"
requirement_status: confirmed
fr: ["FR-FORECAST-002","FR-FORECAST-006"]
nfr: []
invariants: ["INV-001","INV-002","INV-020"]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/domain/forecast-request.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["validation","money"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el servicio devuelve 2350.005 BOB como valor esperado del gasto total"
expected_result:
  - "la serie del gasto total se descarta por salida inválida"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-024 — Un valor que excede la escala de la moneda descarta la serie

## Intención

Verifica el scenario "Escala de la moneda excedida" del requirement "Resultado validado antes de publicarse" de `forecast/expense-forecasting` (FR-FORECAST-002, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el servicio devuelve 2350.005 BOB como valor esperado del gasto total
Entonces la serie del gasto total se descarta por salida inválida
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
