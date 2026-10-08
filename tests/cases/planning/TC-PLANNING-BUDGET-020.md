---
id: TC-PLANNING-BUDGET-020
title: 'Un plan base cero muestra el monto por asignar hasta llegar a cero'
spec: planning/budgets
related_specs: []
requirement: 'Plan base cero con monto por asignar'
scenario: 'Por asignar hasta cero'
requirement_status: confirmed
fr: ['FR-PLANNING-021']
nfr: []
invariants: []
priority: low
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['budgets', 'zero-based']
error_code: null
preconditions:
  - 'Plan base cero con ingresos esperados 8000.00 BOB y gasto planificado 7500.00 BOB'
input:
  newLine: 'Ahorro programado FIXED 500.00 BOB'
steps:
  - 'Consultar el por asignar'
  - 'Agregar la línea y volver a consultar'
expected_result:
  - 'Por asignar 500.00 BOB'
  - 'Tras agregar la línea, por asignar 0.00 BOB'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-020 — Un plan base cero muestra el monto por asignar hasta llegar a cero

## Intención

FR-PLANNING-021 (Could): todo ingreso esperado se asigna.

## Escenario

```gherkin
Dado un plan base cero que espera 8000.00 BOB y planifica 7500.00 BOB
Entonces el monto por asignar es 500.00 BOB
Cuando agrego "Ahorro programado" con fijo 500.00 BOB
Entonces el monto por asignar es 0.00 BOB
```

## Notas

