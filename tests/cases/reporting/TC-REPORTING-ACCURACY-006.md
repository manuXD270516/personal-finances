---
id: TC-REPORTING-ACCURACY-006
title: "Con la función deshabilitada el reporte 16 explica que no está habilitada"
spec: reporting/financial-reports
related_specs: []
requirement: "Reportes ampliados en el catálogo"
scenario: "Catálogo sin la función de pronóstico"
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
tags: ["catalog","degradation"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la función de pronóstico está deshabilitada y un miembro abre \"Pronóstico vs real\" desde el catálogo"
expected_result:
  - "el reporte explica que la función no está habilitada, sin cifras"
created: 2026-11-12
updated: 2026-11-12
---

# TC-REPORTING-ACCURACY-006 — Con la función deshabilitada el reporte 16 explica que no está habilitada

## Intención

Verifica el scenario "Catálogo sin la función de pronóstico" del requirement "Reportes ampliados en el catálogo" de `reporting/financial-reports` (FR-REPORTING-008, FR-REPORTING-001, FR-FORECAST-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la función de pronóstico está deshabilitada y un miembro abre "Pronóstico vs real" desde el catálogo
Entonces el reporte explica que la función no está habilitada, sin cifras
```

## Notas

- Change `add-forecast-accuracy` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
