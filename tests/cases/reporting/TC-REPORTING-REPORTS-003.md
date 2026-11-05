---
id: TC-REPORTING-REPORTS-003
title: "Los periodos se asignan por fecha de negocio y un rango de más de 24 periodos se rechaza"
spec: reporting/financial-reports
related_specs: []
requirement: "Periodos de los reportes"
scenario: "Mes financiero que empieza el día 25"
requirement_status: confirmed
fr: ["FR-REPORTING-009", "FR-PLANNING-001"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/financial-reports.api.test.ts
  - packages/contexts/reporting/src/application/financial-reports.queries.test.ts
  - packages/contexts/reporting/src/domain/report-periods.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["periods"]
error_code: "VALIDATION_FAILED"
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Mes financiero que empieza el día 25"
  - "Gasto de 120.00 BOB con fecha de negocio 2026-10-27"
input:
  grouping: "FINANCIAL_PERIOD | CALENDAR_MONTH"
steps:
  - "Calcular los periodos con agrupación por periodo financiero y por mes calendario"
  - "Pedir un rango mensual 2024-10 → 2026-10"
expected_result:
  - "Por periodo financiero el gasto cae en 2026-10-25 → 2026-11-24"
  - "Por mes calendario cae en 2026-10"
  - "El rango de 25 periodos se rechaza con VALIDATION_FAILED"
  - "El periodo que contiene hoy se marca parcial"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-003 — Los periodos se asignan por fecha de negocio y un rango de más de 24 periodos se rechaza

## Intención

Evita que un gasto cambie de periodo según la zona horaria o el tipo de agrupación.

## Escenario

```gherkin
Dado un mes financiero que empieza el día 25
Cuando hay un gasto con fecha 2026-10-27
Entonces por periodo financiero pertenece al 2026-10-25 → 2026-11-24
  Y por mes calendario pertenece a octubre de 2026
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
