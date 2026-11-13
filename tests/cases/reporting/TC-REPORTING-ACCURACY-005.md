---
id: TC-REPORTING-ACCURACY-005
title: "El catálogo informa los 16 reportes disponibles"
spec: reporting/financial-reports
related_specs: []
requirement: "Reportes ampliados en el catálogo"
scenario: "Catálogo completo de Phase 7"
requirement_status: provisional
fr: ["FR-REPORTING-008","FR-REPORTING-001","FR-FORECAST-009"]
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
tags: ["catalog"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un miembro consulta el catálogo"
expected_result:
  - "los 16 reportes figuran como disponibles, incluido \"Pronóstico vs real\""
created: 2026-11-12
updated: 2026-11-12
---

# TC-REPORTING-ACCURACY-005 — El catálogo informa los 16 reportes disponibles

## Intención

Verifica el scenario "Catálogo completo de Phase 7" del requirement "Reportes ampliados en el catálogo" de `reporting/financial-reports` (FR-REPORTING-008, FR-REPORTING-001, FR-FORECAST-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un miembro consulta el catálogo
Entonces los 16 reportes figuran como disponibles, incluido "Pronóstico vs real"
```

## Notas

- Change `add-forecast-accuracy` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
