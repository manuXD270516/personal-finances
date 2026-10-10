---
id: TC-REPORTING-SPENDABLE-009
title: "Solo las metas activas con plan aportan su pendiente del periodo al disponible"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Aportes planificados pendientes a metas descontados"
scenario: "Aporte parcial del periodo"
requirement_status: provisional
fr: ["FR-GOALS-009", "FR-PLANNING-024"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5", "goals", "plan"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (periodo \"2026-10\")"
  - "\"Fondo de emergencia\" plan 1500.00 BOB con 900.00 BOB aportados en \"2026-10\""
  - "\"Laptop\" plan 800.00 BOB pausada"
input: {}
steps:
  - "Calcular el término de aportes planificados"
expected_result:
  - "plannedGoalContributions 600.00 BOB"
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-009 — Solo las metas activas con plan aportan su pendiente del periodo al disponible

## Intención

FR-GOALS-009: los aportes planificados se reflejan en Q5.

## Escenario

```gherkin
Dado un plan de 1500.00 BOB con 900.00 BOB aportados y "Laptop" pausada
Cuando calculo el disponible
Entonces los aportes planificados restan 600.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
