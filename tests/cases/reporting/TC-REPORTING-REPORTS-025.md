---
id: TC-REPORTING-REPORTS-025
title: "Los reportes son de solo lectura para todos los miembros y no mezclan workspaces"
spec: reporting/financial-reports
related_specs: ["security/access-control"]
requirement: "Reportes de solo lectura para todos los miembros y aislados por workspace"
scenario: "Otro workspace"
requirement_status: provisional
fr: ["FR-REPORTING-008"]
nfr: ["NFR-SEC-003"]
invariants: ["INV-025"]
priority: critical
type: security
level: security
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["rls", "isolation"]
error_code: null
preconditions:
  - "Workspaces W1 y W2 con gastos en 2026-10"
  - "Usuario X no miembro de W1"
input: {}
steps:
  - "Miembro de W1 (OWNER, EDITOR y VIEWER) pide gastos por categoría y su drill-down"
  - "X pide un reporte de W1"
expected_result:
  - "Los resultados de W1 no incluyen nada de W2"
  - "X recibe 403 sin datos de W1"
  - "Ninguna consulta modifica datos financieros"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-025 — Los reportes son de solo lectura para todos los miembros y no mezclan workspaces

## Intención

INV-025 y RLS fail-closed también en los reportes y sus exportaciones.

## Escenario

```gherkin
Dado W1 y W2 con gastos en 2026-10
Cuando un miembro de W1 consulta el reporte
Entonces el resultado no incluye movimientos de W2
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
