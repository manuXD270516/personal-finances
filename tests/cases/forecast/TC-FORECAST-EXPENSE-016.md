---
id: TC-FORECAST-EXPENSE-016
title: "La vista muestra el aviso de no asesoría financiera en el idioma del usuario"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Aviso de no asesoría financiera"
scenario: "Aviso en la vista"
requirement_status: provisional
fr: []
nfr: ["NFR-COMP-004"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["ui","i18n","NFR-COMP-004"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un miembro abre la vista de pronósticos en inglés"
expected_result:
  - "la vista muestra el aviso de estimación estadística sin asesoría financiera en inglés"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-EXPENSE-016 — La vista muestra el aviso de no asesoría financiera en el idioma del usuario

## Intención

Verifica el scenario "Aviso en la vista" del requirement "Aviso de no asesoría financiera" de `forecast/expense-forecasting` (NFR-COMP-004).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un miembro abre la vista de pronósticos en inglés
Entonces la vista muestra el aviso de estimación estadística sin asesoría financiera en inglés
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
