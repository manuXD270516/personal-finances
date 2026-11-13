---
id: TC-FORECAST-SERVICE-039
title: "Un workspace importado empieza sin corridas"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Pronósticos fuera de la portabilidad del workspace"
scenario: "Workspace importado"
requirement_status: confirmed
fr: ["FR-IDENTITY-010"]
nfr: ["NFR-COMP-002"]
invariants: []
priority: low
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/src/portability/portability-coverage.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["portability"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "se importa en un workspace nuevo la exportación de \"W1 Personal Demo\", que tenía 12 corridas"
expected_result:
  - "el workspace nuevo no tiene corridas y la consulta informa que no hay pronóstico"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-039 — Un workspace importado empieza sin corridas

## Intención

Verifica el scenario "Workspace importado" del requirement "Pronósticos fuera de la portabilidad del workspace" de `forecast/expense-forecasting` (FR-IDENTITY-010, NFR-COMP-002).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando se importa en un workspace nuevo la exportación de "W1 Personal Demo", que tenía 12 corridas
Entonces el workspace nuevo no tiene corridas y la consulta informa que no hay pronóstico
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
