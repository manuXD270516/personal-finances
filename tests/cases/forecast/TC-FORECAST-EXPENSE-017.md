---
id: TC-FORECAST-EXPENSE-017
title: "La vista explica cuántos periodos faltan y muestra solo la estimación simple y conocidos"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Aviso claro de datos insuficientes"
scenario: "Categoría con 4 periodos"
requirement_status: confirmed
fr: ["FR-FORECAST-005"]
nfr: []
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/forecasts/forecasts.test.tsx
  - packages/contexts/forecasting/src/application/expense-forecast.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["ui","readiness"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "\"Restaurantes\" tiene 4 periodos de historia"
expected_result:
  - "la vista indica que se necesitan 2 periodos más de historia en \"Restaurantes\" para un pronóstico estadístico"
  - "muestra la estimación simple marcada como tal y sus costos conocidos"
created: 2026-11-12
updated: 2026-11-13
---

# TC-FORECAST-EXPENSE-017 — La vista explica cuántos periodos faltan y muestra solo la estimación simple y conocidos

## Intención

Verifica el scenario "Categoría con 4 periodos" del requirement "Aviso claro de datos insuficientes" de `forecast/expense-forecasting` (FR-FORECAST-005).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando "Restaurantes" tiene 4 periodos de historia
Entonces la vista indica que se necesitan 2 periodos más de historia en "Restaurantes" para un pronóstico estadístico
  Y muestra la estimación simple marcada como tal y sus costos conocidos
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
