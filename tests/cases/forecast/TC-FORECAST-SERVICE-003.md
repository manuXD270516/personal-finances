---
id: TC-FORECAST-SERVICE-003
title: "Una corrida completada reemplaza a la vigente anterior"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Corrida de pronóstico con ciclo de vida"
scenario: "Corrida completada reemplaza a la anterior"
requirement_status: confirmed
fr: ["FR-FORECAST-001","FR-FORECAST-002"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/application/forecasting.test.ts
  - packages/contexts/forecasting/src/domain/forecast-run.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["run-lifecycle"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el workspace tiene la corrida completada \"R1\" del 2026-10-01 y la corrida \"R2\" se completa el 2026-11-01"
expected_result:
  - "\"R1\" queda reemplazada y \"R2\" es el pronóstico vigente"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-003 — Una corrida completada reemplaza a la vigente anterior

## Intención

Verifica el scenario "Corrida completada reemplaza a la anterior" del requirement "Corrida de pronóstico con ciclo de vida" de `forecast/expense-forecasting` (FR-FORECAST-001, FR-FORECAST-002).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el workspace tiene la corrida completada "R1" del 2026-10-01 y la corrida "R2" se completa el 2026-11-01
Entonces "R1" queda reemplazada y "R2" es el pronóstico vigente
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
