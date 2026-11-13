---
id: TC-FORECAST-EXPENSE-015
title: "El pronóstico se presenta como esperado con rango probable en es-BO"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Pronóstico presentado como rango"
scenario: "Tarjeta del gasto total en es-BO"
requirement_status: provisional
fr: ["FR-FORECAST-004"]
nfr: []
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["ui","i18n","copy"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un miembro con locale es-BO ve el gasto total de 2026-12 con valor esperado 4408.00 BOB e intervalo del 80 % de 4038.00 BOB a 4788.00 BOB"
expected_result:
  - "la vista muestra \"Esperado: ~Bs 4.408,00 · Rango probable: Bs 4.038,00 – Bs 4.788,00 (80 %)\""
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-EXPENSE-015 — El pronóstico se presenta como esperado con rango probable en es-BO

## Intención

Verifica el scenario "Tarjeta del gasto total en es-BO" del requirement "Pronóstico presentado como rango" de `forecast/expense-forecasting` (FR-FORECAST-004).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un miembro con locale es-BO ve el gasto total de 2026-12 con valor esperado 4408.00 BOB e intervalo del 80 % de 4038.00 BOB a 4788.00 BOB
Entonces la vista muestra "Esperado: ~Bs 4.408,00 · Rango probable: Bs 4.038,00 – Bs 4.788,00 (80 %)"
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
