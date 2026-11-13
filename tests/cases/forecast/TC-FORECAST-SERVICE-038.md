---
id: TC-FORECAST-SERVICE-038
title: "La retención conserva la corrida del inicio del periodo y purga las demás reemplazadas"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Retención de las corridas"
scenario: "Corridas reemplazadas del mismo periodo"
requirement_status: confirmed
fr: ["FR-FORECAST-009"]
nfr: ["NFR-COMP-002"]
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/application/forecasting.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["retention"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el periodo 2026-11 tuvo las corridas completadas del 2026-11-01 y del 2026-11-08, ambas reemplazadas, y hoy es 2026-12-15"
expected_result:
  - "la corrida del 2026-11-08 se purga y la del 2026-11-01 se conserva para evaluar el periodo 2026-11"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-038 — La retención conserva la corrida del inicio del periodo y purga las demás reemplazadas

## Intención

Verifica el scenario "Corridas reemplazadas del mismo periodo" del requirement "Retención de las corridas" de `forecast/expense-forecasting` (FR-FORECAST-009, NFR-COMP-002).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el periodo 2026-11 tuvo las corridas completadas del 2026-11-01 y del 2026-11-08, ambas reemplazadas, y hoy es 2026-12-15
Entonces la corrida del 2026-11-08 se purga y la del 2026-11-01 se conserva para evaluar el periodo 2026-11
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
