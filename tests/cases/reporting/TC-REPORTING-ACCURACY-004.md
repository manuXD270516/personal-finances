---
id: TC-REPORTING-ACCURACY-004
title: "Sin periodos evaluados el reporte indica el primero y desde cuándo"
spec: reporting/financial-reports
related_specs: []
requirement: "Pronóstico vs real sin periodos evaluados"
scenario: "Primera corrida reciente"
requirement_status: provisional
fr: ["FR-FORECAST-009","FR-REPORTING-008"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["reports"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la primera corrida completada es del 2026-12-01, el periodo 2026-12 termina el 2026-12-31 y la gracia es de 5 días"
expected_result:
  - "el reporte indica que el primer periodo evaluado será 2026-12 a partir del 2027-01-06"
created: 2026-11-12
updated: 2026-11-12
---

# TC-REPORTING-ACCURACY-004 — Sin periodos evaluados el reporte indica el primero y desde cuándo

## Intención

Verifica el scenario "Primera corrida reciente" del requirement "Pronóstico vs real sin periodos evaluados" de `reporting/financial-reports` (FR-FORECAST-009, FR-REPORTING-008).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la primera corrida completada es del 2026-12-01, el periodo 2026-12 termina el 2026-12-31 y la gracia es de 5 días
Entonces el reporte indica que el primer periodo evaluado será 2026-12 a partir del 2027-01-06
```

## Notas

- Change `add-forecast-accuracy` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
