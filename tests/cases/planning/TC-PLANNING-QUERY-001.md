---
id: TC-PLANNING-QUERY-001
title: Cualquier miembro lista periodos y obtiene el periodo de una fecha
spec: planning/financial-periods
related_specs: []
requirement: Consulta de periodos
scenario: Periodo de una fecha
requirement_status: provisional
fr:
  - FR-PLANNING-001
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - financial-periods
error_code: null
preconditions:
  - Hoy es 2026-11-03, día de inicio 1
  - '"2026-10" y "2026-11" active, futuros en draft'
  - Usuario VIEWER
input:
  - containsDate: 2026-10-31
  - status: ACTIVE
  - containsDate: 2031-01-01
steps:
  - GET /periods?containsDate=2026-10-31
  - GET /periods?status=ACTIVE
  - GET /periods?containsDate=2031-01-01
expected_result:
  - Devuelve "2026-10" (2026-10-01..2026-10-31) con su estado
  - Lista "2026-10" con pendingClosure true y "2026-11" con pendingClosure false
  - La fecha sin periodo responde 404 REFERENCE_NOT_FOUND
  - Las respuestas validan contra el contrato OpenAPI
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-QUERY-001 — Cualquier miembro lista periodos y obtiene el periodo de una fecha

## Intención

El selector de periodo y el cierre necesitan saber qué periodo contiene una fecha y cuáles están pendientes de cierre.

## Escenario

```gherkin
Dado un VIEWER del workspace
Cuando consulta el periodo que contiene 2026-10-31
Entonces obtiene "2026-10" del 2026-10-01 al 2026-10-31
```

## Notas

- Cubre los tres scenarios del requirement.
