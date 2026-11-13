---
id: TC-FORECAST-SERVICE-018
title: "Dos periodos sin registros truncan la historia de todas las series"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Huecos en la historia"
scenario: "Dos periodos sin registros"
requirement_status: confirmed
fr: ["FR-FORECAST-005"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/domain/readiness-gate.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["readiness"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el workspace tiene transacciones de 2025-11 a 2026-02, ninguna en 2026-03 y 2026-04, y de nuevo desde 2026-05 hasta 2026-10"
expected_result:
  - "la historia de todas las series empieza en 2026-05 con 6 periodos"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-018 — Dos periodos sin registros truncan la historia de todas las series

## Intención

Verifica el scenario "Dos periodos sin registros" del requirement "Huecos en la historia" de `forecast/expense-forecasting` (FR-FORECAST-005).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el workspace tiene transacciones de 2025-11 a 2026-02, ninguna en 2026-03 y 2026-04, y de nuevo desde 2026-05 hasta 2026-10
Entonces la historia de todas las series empieza en 2026-05 con 6 periodos
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
