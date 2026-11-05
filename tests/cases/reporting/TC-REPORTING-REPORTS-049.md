---
id: TC-REPORTING-REPORTS-049
title: "Una vista guardada se abre con sus parámetros y los nombres repetidos y la vista 51 se rechazan"
spec: reporting/financial-reports
related_specs: []
requirement: "Vistas guardadas de reportes"
scenario: "Guardar y abrir los gastos del viaje"
requirement_status: provisional
fr: ["FR-REPORTING-019"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["saved-views"]
error_code: "SAVED_VIEW_LIMIT_EXCEEDED"
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Owner autenticado"
input:
  name: "Gastos del viaje"
  reportId: "EXPENSES_BY_TAG"
  range: "LAST_N_PERIODS 3"
steps:
  - "POST W/reports/saved-views"
  - "GET W/reports/saved-views y abrir la vista"
  - "POST con el mismo nombre y reporte"
  - "Crear vistas hasta 50 y pedir la 51"
expected_result:
  - "201 y la vista aparece en la lista"
  - "El reporte se pide con los parámetros guardados y el rango calculado desde hoy"
  - "Nombre repetido ⇒ 409 SAVED_VIEW_NAME_TAKEN"
  - "Vista 51 ⇒ 422 SAVED_VIEW_LIMIT_EXCEEDED"
  - "La vista no guarda montos"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-049 — Una vista guardada se abre con sus parámetros y los nombres repetidos y la vista 51 se rechazan

## Intención

FR-REPORTING-019: filtros favoritos reutilizables.

## Escenario

```gherkin
Dado el owner
Cuando guarda "Gastos del viaje" y la abre
Entonces el reporte se pide con los mismos parámetros
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.
