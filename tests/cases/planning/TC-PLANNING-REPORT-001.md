---
id: TC-PLANNING-REPORT-001
title: El reporte de cierre muestra la versión vigente y sus versiones; un periodo nunca cerrado da 404
spec: planning/month-closing
related_specs: []
requirement: Reporte de cierre consultable
scenario: Reporte vigente tras el re-cierre
requirement_status: confirmed
fr:
  - FR-PLANNING-004
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - month-closing
  - report
error_code: null
preconditions:
  - '"2026-10" con snapshots 1 y 2'
  - '"2026-12" en draft'
  - Usuario VIEWER
input:
  - period: 2026-10
  - period: 2026-12
steps:
  - GET /periods/{id}/close-report de "2026-10"
  - GET /periods/{id}/close-report de "2026-12"
expected_result:
  - Snapshot 2 con Bank A 5185.00 BOB, ahorro 3534.50 BOB y versiones [1, 2], con quién y cuándo cerró
  - '"2026-12" responde 404 REFERENCE_NOT_FOUND'
  - La respuesta valida contra el contrato OpenAPI
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-REPORT-001 — El reporte de cierre muestra la versión vigente y sus versiones; un periodo nunca cerrado da 404

## Intención

FR-PLANNING-004: el reporte de cierre es consultable por cualquier miembro.

## Escenario

```gherkin
Dado que "2026-10" tiene los snapshots 1 y 2
Cuando un VIEWER consulta su reporte de cierre
Entonces obtiene el snapshot 2 con "Bank A" en 5185.00 BOB
```

## Notas

- Cubre "Periodo nunca cerrado".
