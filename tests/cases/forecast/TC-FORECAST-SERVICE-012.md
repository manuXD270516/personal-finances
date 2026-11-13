---
id: TC-FORECAST-SERVICE-012
title: "Un flujo sin tasa se excluye y se cuenta en la calidad de datos, nunca 1:1"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Series mensuales por periodo financiero"
scenario: "Flujo sin tasa"
requirement_status: confirmed
fr: ["FR-FORECAST-001"]
nfr: ["NFR-DATA-002"]
invariants: []
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/domain/period-series-builder.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["multi-currency","fx"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "además registró un gasto de 20.000000 USDT en una fecha sin tasa USDT a BOB"
expected_result:
  - "el periodo 2026-10 sigue con 1448.00 BOB y su calidad de datos informa 1 flujo sin valorar"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-012 — Un flujo sin tasa se excluye y se cuenta en la calidad de datos, nunca 1:1

## Intención

Verifica el scenario "Flujo sin tasa" del requirement "Series mensuales por periodo financiero" de `forecast/expense-forecasting` (FR-FORECAST-001, NFR-DATA-002).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando además registró un gasto de 20.000000 USDT en una fecha sin tasa USDT a BOB
Entonces el periodo 2026-10 sigue con 1448.00 BOB y su calidad de datos informa 1 flujo sin valorar
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
