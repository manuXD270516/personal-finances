---
id: TC-FORECAST-SERVICE-026
title: "El total se pronostica 12 periodos y una categoría con 14 periodos de historia 6"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Horizonte de las series"
scenario: "Horizonte del gasto total y de una categoría"
requirement_status: confirmed
fr: ["FR-FORECAST-001"]
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/application/forecasting.test.ts
  - packages/contexts/forecasting/src/domain/readiness-gate.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["horizon"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el 2026-11-05 el último periodo terminado es 2026-10 y \"Restaurantes\" tiene 14 periodos de historia"
expected_result:
  - "el gasto total se pronostica de 2026-11 a 2027-10 y \"Restaurantes\" de 2026-11 a 2027-04"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-026 — El total se pronostica 12 periodos y una categoría con 14 periodos de historia 6

## Intención

Verifica el scenario "Horizonte del gasto total y de una categoría" del requirement "Horizonte de las series" de `forecast/expense-forecasting` (FR-FORECAST-001).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el 2026-11-05 el último periodo terminado es 2026-10 y "Restaurantes" tiene 14 periodos de historia
Entonces el gasto total se pronostica de 2026-11 a 2027-10 y "Restaurantes" de 2026-11 a 2027-04
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
