---
id: TC-FORECAST-SERVICE-011
title: "La historia del periodo convierte con la tasa de cada fecha y descuenta el reembolso"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Series mensuales por periodo financiero"
scenario: "Periodo con gastos en dos monedas y un reembolso"
requirement_status: confirmed
fr: ["FR-FORECAST-001"]
nfr: ["NFR-DATA-002"]
invariants: ["INV-001","INV-002","INV-020"]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/domain/period-series-builder.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["money","multi-currency","periods"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el workspace tiene día de inicio del mes financiero 25 y en el periodo 2026-10 (del 2026-09-25 al 2026-10-24) registró gastos de 1200.00 BOB y 50.00 USD el 2026-10-02 con tasa 6.96 BOB por USD, y un reembolso de 100.00 BOB"
expected_result:
  - "la historia del gasto total tiene 1448.00 BOB en el periodo 2026-10"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-011 — La historia del periodo convierte con la tasa de cada fecha y descuenta el reembolso

## Intención

Verifica el scenario "Periodo con gastos en dos monedas y un reembolso" del requirement "Series mensuales por periodo financiero" de `forecast/expense-forecasting` (FR-FORECAST-001, NFR-DATA-002).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el workspace tiene día de inicio del mes financiero 25 y en el periodo 2026-10 (del 2026-09-25 al 2026-10-24) registró gastos de 1200.00 BOB y 50.00 USD el 2026-10-02 con tasa 6.96 BOB por USD, y un reembolso de 100.00 BOB
Entonces la historia del gasto total tiene 1448.00 BOB en el periodo 2026-10
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
