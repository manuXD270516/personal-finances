---
id: TC-GOALS-SAVINGS-050
title: "El plan del periodo muestra la sección de aportes a metas sin cambiar el disponible para gastar del plan"
spec: planning/budgets
related_specs: ["goals/savings-goals"]
requirement: "Aportes planificados a metas en el plan del periodo"
scenario: "Dos metas en el plan de octubre"
requirement_status: provisional
fr: ["FR-GOALS-009", "FR-PLANNING-008"]
nfr: []
invariants: []
priority: low
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "planning"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Plan de \"2026-10\" con disponible para gastar 3750.00 BOB"
  - "\"Fondo de emergencia\" plan 1500.00 BOB con 1000.00 BOB aportados; \"Laptop\" plan 800.00 BOB sin aportes"
input: {}
steps:
  - "GET W/budgets/{id}"
  - "Pausar \"Laptop\" y repetir"
expected_result:
  - "goalContributions: pendientes 500.00 y 800.00 BOB, total 1300.00 BOB; disponible 3750.00 BOB"
  - "Con \"Laptop\" pausada: total 500.00 BOB"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-050 — El plan del periodo muestra la sección de aportes a metas sin cambiar el disponible para gastar del plan

## Intención

FR-GOALS-009: los aportes planificados aparecen en el plan sin crear líneas (pregunta 15).

## Escenario

```gherkin
Dado el plan de octubre con dos metas planificadas
Cuando lo consulto
Entonces la sección de aportes a metas suma 1300.00 BOB pendientes
  Y el disponible para gastar del plan no cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
