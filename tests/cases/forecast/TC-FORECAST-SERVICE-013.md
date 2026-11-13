---
id: TC-FORECAST-SERVICE-013
title: "El periodo en curso no entra en la historia"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Series mensuales por periodo financiero"
scenario: "Periodo en curso fuera de la historia"
requirement_status: confirmed
fr: ["FR-FORECAST-001"]
nfr: ["NFR-DATA-002"]
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/domain/period-series-builder.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["periods"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el 2026-11-10 se construye la historia con día de inicio 1"
expected_result:
  - "el último periodo de la historia es 2026-10 y el periodo 2026-11 no se incluye"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-013 — El periodo en curso no entra en la historia

## Intención

Verifica el scenario "Periodo en curso fuera de la historia" del requirement "Series mensuales por periodo financiero" de `forecast/expense-forecasting` (FR-FORECAST-001, NFR-DATA-002).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el 2026-11-10 se construye la historia con día de inicio 1
Entonces el último periodo de la historia es 2026-10 y el periodo 2026-11 no se incluye
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
