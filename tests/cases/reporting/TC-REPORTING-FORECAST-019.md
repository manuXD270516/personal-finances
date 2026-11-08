---
id: TC-REPORTING-FORECAST-019
title: "El episodio se cierra con riesgo NONE o LOW, se reabre con un riesgo alto nuevo y POSSIBLE no abre episodios"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Detección periódica del riesgo de déficit"
scenario: "Riesgo resuelto y nuevo episodio"
requirement_status: confirmed
fr: ["FR-REPORTING-015"]
nfr: []
invariants: []
priority: high
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - apps/api/test/events/cash-flow-watch.int.test.ts
  - packages/contexts/reporting/src/application/evaluate-shortfall-risk.test.ts
  - packages/contexts/reporting/src/domain/category-variation.test.ts
  - packages/contexts/reporting/test/integration/pg-cash-flow.int.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["cash-flow","shortfall","job"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Episodio abierto de BOB"
input: {"job":"reporting.cash-flow-watch"}
steps:
  - "Registrar un ingreso pendiente de 3000.00 BOB y correr el job"
  - "Volver a un riesgo HIGH días después y correr el job"
  - "Con riesgo POSSIBLE correr el job"
  - "Correr dos evaluaciones simultáneas"
expected_result:
  - "Episodio cerrado y hecho reporting.CashFlowShortfallRiskCleared.v1"
  - "Episodio nuevo con hecho detectado nuevo"
  - "POSSIBLE: ningún episodio ni hecho"
  - "Concurrencia: un solo episodio abierto y un solo hecho"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-019 — El episodio se cierra con riesgo NONE o LOW, se reabre con un riesgo alto nuevo y POSSIBLE no abre episodios

## Intención

Ciclo de vida del episodio e idempotencia ante carreras.

## Escenario

```gherkin
Dado Episodio abierto de BOB
Cuando Registrar un ingreso pendiente de 3000.00 BOB y correr el job
Entonces Episodio cerrado y hecho reporting.CashFlowShortfallRiskCleared.v1
  Y Episodio nuevo con hecho detectado nuevo
  Y POSSIBLE: ningún episodio ni hecho
  Y Concurrencia: un solo episodio abierto y un solo hecho
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Detección periódica del riesgo de déficit" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
