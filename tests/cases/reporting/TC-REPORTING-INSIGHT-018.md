---
id: TC-REPORTING-INSIGHT-018
title: "La tarjeta de Q5 lista las líneas en riesgo por fecha estimada"
spec: reporting/dashboard
related_specs: []
requirement: "Líneas en riesgo de exceder en el Home"
scenario: "Dos líneas en riesgo"
requirement_status: provisional
fr: ["FR-REPORTING-020","FR-REPORTING-001"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["budget-risk"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; pronósticos deshabilitados salvo que el escenario diga otro"
input: {}
steps:
  - "el 2026-11-10 \"Restaurantes\" tiene riesgo LIKELY con fecha 2026-11-22 y \"Servicios\" con fecha 2026-11-21"
  - "se pide el resumen del Home"
expected_result:
  - "budgetRisk.lines trae primero \"Servicios\" y luego \"Restaurantes\" con moreCount 0"
  - "el disponible para gastar es el mismo que con la función deshabilitada"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-018 — La tarjeta de Q5 lista las líneas en riesgo por fecha estimada

## Intención

Verifica el scenario "Dos líneas en riesgo" del requirement "Líneas en riesgo de exceder en el Home" de `reporting/dashboard` (FR-REPORTING-020, FR-REPORTING-001).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando el 2026-11-10 "Restaurantes" tiene riesgo LIKELY con fecha 2026-11-22 y "Servicios" con fecha 2026-11-21
Y se pide el resumen del Home
Entonces budgetRisk.lines trae primero "Servicios" y luego "Restaurantes" con moreCount 0
Y el disponible para gastar es el mismo que con la función deshabilitada
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
