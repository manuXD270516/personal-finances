---
id: TC-PLANNING-BUDGET-018
title: 'El rollover es provisional hasta cerrar el periodo anterior y se recalcula al reabrir'
spec: planning/budgets
related_specs: ['planning/month-closing']
requirement: 'Rollover provisional hasta el cierre del periodo anterior'
scenario: 'Reapertura con gasto adicional'
requirement_status: provisional
fr: ['FR-PLANNING-020', 'FR-PLANNING-006']
nfr: []
invariants: ['INV-015', 'INV-028']
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ['budgets', 'rollover', 'events']
error_code: null
preconditions:
  - '"Restaurantes" máximo 600.00 BOB con rollover solo positivo en "2026-10" y "2026-11"'
  - '"2026-10" cerrado con gastado 520.00 BOB (remanente 80.00 BOB definitivo)'
input:
  reopenExpense: '30.00 BOB Restaurantes 2026-10-28'
steps:
  - 'Reabrir "2026-10" (planning.PeriodReopened.v1)'
  - 'Postear el gasto de 30.00 BOB'
  - 'Volver a cerrar "2026-10" (planning.MonthClosed.v1)'
  - 'Consultar "2026-11"'
expected_result:
  - 'Tras reabrir, el remanente de "2026-11" se muestra provisional'
  - 'Tras re-cerrar, el remanente es 50.00 BOB definitivo y el planificado efectivo 650.00 BOB'
  - 'Reentregar MonthClosed no cambia el resultado'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-BUDGET-018 — El rollover es provisional hasta cerrar el periodo anterior y se recalcula al reabrir

## Intención

FR-PLANNING-020 + FR-PLANNING-006: el remanente depende del gastado final del periodo anterior.

## Escenario

```gherkin
Dado "2026-10" cerrado con remanente 80.00 BOB en "Restaurantes"
Cuando se reabre, se registra un gasto de 30.00 BOB del 2026-10-28 y se vuelve a cerrar
Entonces el remanente trasladado a "2026-11" es 50.00 BOB
  Y su planificado efectivo es 650.00 BOB
```

## Notas

- draft: depende de los eventos de add-month-closing (sibling pf-p2a).
