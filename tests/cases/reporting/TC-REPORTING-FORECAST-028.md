---
id: TC-REPORTING-FORECAST-028
title: "Una categoría de ingreso o archivada se rechaza y un EDITOR no puede cambiar los ajustes"
spec: reporting/dashboard
related_specs: []
requirement: "Ajustes del disponible del workspace"
scenario: "Categoría de ingreso rechazada"
requirement_status: confirmed
fr: ["FR-PLANNING-024","FR-IDENTITY-006"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/cash-flow-calendar.api.test.ts
  - apps/web/src/ui/cash-flow/forecast-home.test.tsx
  - packages/contexts/reporting/src/application/spendable-settings.use-cases.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["spendable","settings","rbac"]
error_code: CATEGORY_KIND_MISMATCH
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
input: {}
steps:
  - "OWNER marca \"Salario\" (ingreso)"
  - "OWNER marca una categoría archivada"
  - "EDITOR cambia el modo"
  - "VIEWER lee los ajustes"
expected_result:
  - "422 CATEGORY_KIND_MISMATCH"
  - "409 CATEGORY_ARCHIVED"
  - "403 INSUFFICIENT_ROLE"
  - "VIEWER: 200 con los ajustes vigentes"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-028 — Una categoría de ingreso o archivada se rechaza y un EDITOR no puede cambiar los ajustes

## Intención

Validación y autorización de la configuración del workspace.

## Escenario

```gherkin
Dado Workspace "W1" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1
Cuando OWNER marca "Salario" (ingreso)
Entonces 422 CATEGORY_KIND_MISMATCH
  Y 409 CATEGORY_ARCHIVED
  Y 403 INSUFFICIENT_ROLE
  Y VIEWER: 200 con los ajustes vigentes
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Ajustes del disponible del workspace" de `reporting/dashboard`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
