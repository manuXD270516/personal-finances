---
id: TC-REPORTING-PREDICTED-006
title: "Con la función deshabilitada el calendario no tiene bandas y no cambia"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Calendario sin pronóstico disponible"
scenario: "Función deshabilitada"
requirement_status: confirmed
fr: ["FR-FORECAST-006","FR-FORECAST-008"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/forecasting.api.test.ts
  - apps/web/src/ui/cash-flow/cash-flow.test.tsx
  - packages/contexts/reporting/src/application/predicted-cash-flow.queries.test.ts
  - tests/e2e/specs/predicted-cash-flow-band.spec.ts
status: automated
regression_suite: false
phase: 8
tags: ["cash-flow","degradation"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la función de pronóstico está deshabilitada y un miembro pide el calendario de 30 días"
expected_result:
  - "el calendario no tiene bandas, informa el motivo función no habilitada y sus demás cifras son las mismas que sin la función"
created: 2026-11-12
updated: 2026-11-13
---

# TC-REPORTING-PREDICTED-006 — Con la función deshabilitada el calendario no tiene bandas y no cambia

## Intención

Verifica el scenario "Función deshabilitada" del requirement "Calendario sin pronóstico disponible" de `reporting/cash-flow-calendar` (FR-FORECAST-006, FR-FORECAST-008).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la función de pronóstico está deshabilitada y un miembro pide el calendario de 30 días
Entonces el calendario no tiene bandas, informa el motivo función no habilitada y sus demás cifras son las mismas que sin la función
```

## Notas

- Change `add-predicted-cash-flow-band` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
