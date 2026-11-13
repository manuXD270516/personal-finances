---
id: TC-FORECAST-SERVICE-022
title: "Las referencias opacas cambian en cada corrida"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Datos mínimos enviados al servicio de pronósticos"
scenario: "Referencias distintas en cada corrida"
requirement_status: provisional
fr: ["FR-FORECAST-006"]
nfr: ["NFR-COMP-001","NFR-COMP-002"]
invariants: []
priority: high
type: security
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["privacy"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "se arman las peticiones de las corridas \"R2\" y \"R3\" del mismo workspace"
expected_result:
  - "la serie de \"Restaurantes\" tiene referencias opacas distintas en cada una"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-022 — Las referencias opacas cambian en cada corrida

## Intención

Verifica el scenario "Referencias distintas en cada corrida" del requirement "Datos mínimos enviados al servicio de pronósticos" de `forecast/expense-forecasting` (NFR-COMP-001, NFR-COMP-002, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando se arman las peticiones de las corridas "R2" y "R3" del mismo workspace
Entonces la serie de "Restaurantes" tiene referencias opacas distintas en cada una
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
