---
id: TC-FORECAST-SERVICE-006
title: "Una segunda solicitud con una corrida en curso se rechaza"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Solicitud manual de una corrida"
scenario: "Corrida ya en curso"
requirement_status: confirmed
fr: ["FR-FORECAST-001","FR-FORECAST-006"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/forecasting.api.test.ts
  - packages/contexts/forecasting/src/application/forecasting.test.ts
  - packages/contexts/forecasting/test/integration/pg-forecasting.int.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["manual-run"]
error_code: FORECAST_RUN_IN_PROGRESS
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un OWNER solicita una corrida mientras otra está en curso"
expected_result:
  - "la solicitud se rechaza con `FORECAST_RUN_IN_PROGRESS`"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-006 — Una segunda solicitud con una corrida en curso se rechaza

## Intención

Verifica el scenario "Corrida ya en curso" del requirement "Solicitud manual de una corrida" de `forecast/expense-forecasting` (FR-FORECAST-001, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un OWNER solicita una corrida mientras otra está en curso
Entonces la solicitud se rechaza con `FORECAST_RUN_IN_PROGRESS`
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
