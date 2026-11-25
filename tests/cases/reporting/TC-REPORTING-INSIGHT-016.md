---
id: TC-REPORTING-INSIGHT-016
title: "El riesgo de un periodo de otro workspace responde como inexistente"
spec: reporting/predictive-insights
related_specs: []
requirement: "Permisos y aislamiento del riesgo"
scenario: "Periodo de otro workspace"
requirement_status: provisional
fr: ["FR-REPORTING-020","FR-IDENTITY-006"]
nfr: ["NFR-SEC-003","NFR-SEC-004"]
invariants: []
priority: critical
type: security
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["budget-risk","rls"]
error_code: "RESOURCE_NOT_FOUND"
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; pronósticos deshabilitados salvo que el escenario diga otro"
input: {}
steps:
  - "el OWNER de \"W1\" pide el riesgo de un periodo de \"W2\""
expected_result:
  - "se responde 404 RESOURCE_NOT_FOUND"
  - "reporting.budget_overrun_notice tiene RLS forzada y está registrada en platform.workspace_scoped_table"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-016 — El riesgo de un periodo de otro workspace responde como inexistente

## Intención

Verifica el scenario "Periodo de otro workspace" del requirement "Permisos y aislamiento del riesgo" de `reporting/predictive-insights` (FR-REPORTING-020, FR-IDENTITY-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando el OWNER de "W1" pide el riesgo de un periodo de "W2"
Entonces se responde 404 RESOURCE_NOT_FOUND
Y reporting.budget_overrun_notice tiene RLS forzada y está registrada en platform.workspace_scoped_table
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
