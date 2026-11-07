---
id: TC-REPORTING-FORECAST-030
title: "Con el dataset demo las nueve preguntas del Home muestran su respuesta completa"
spec: reporting/dashboard
related_specs: []
requirement: "Las nueve preguntas del Home respondidas por completo"
scenario: "Checklist de aceptación del Home"
requirement_status: confirmed
fr: ["FR-REPORTING-001","FR-REPORTING-002"]
nfr: ["NFR-PERF-004"]
invariants: []
priority: critical
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/cash-flow-forecast.spec.ts
status: automated
regression_suite: false
phase: 7
tags: ["home","sm-05","e2e"]
error_code: null
preconditions:
  - "Workspace demo (Demo v2) con cuentas en BOB y USD, compromisos, tarjeta, préstamo y metas"
  - "PF_E2E_PROJECT propio"
input: {}
steps:
  - "Abrir el Home"
expected_result:
  - "Q1–Q9 con cifras; ninguna no disponible ni sin datos"
  - "Q8 con saldo más bajo y riesgo de 30 días; Q7 con variación por categoría"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-030 — Con el dataset demo las nueve preguntas del Home muestran su respuesta completa

## Intención

Criterio de salida de Phase 7: SM-05 (checklist de aceptación del dashboard).

## Escenario

```gherkin
Dado PF_E2E_PROJECT propio
Cuando Abrir el Home
Entonces Q1–Q9 con cifras; ninguna no disponible ni sin datos
  Y Q8 con saldo más bajo y riesgo de 30 días; Q7 con variación por categoría
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Las nueve preguntas del Home respondidas por completo" de `reporting/dashboard`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
