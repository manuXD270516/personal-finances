---
id: TC-PLANNING-BUDGET-015
title: 'Un presupuesto mínimo informa cuánto falta y cuándo se cumple'
spec: planning/budgets
related_specs: []
requirement: 'Presupuesto de tipo mínimo'
scenario: 'Mínimo pendiente y cumplido'
requirement_status: confirmed
fr: ['FR-PLANNING-019']
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['budgets', 'minimum']
error_code: null
preconditions:
  - '"Educación" con mínimo 400.00 BOB'
input:
  actualA: '250.00 BOB'
  actualB: '450.00 BOB'
steps:
  - 'Calcular el progreso con 250.00 BOB'
  - 'Calcular el progreso con 450.00 BOB'
expected_result:
  - 'Con 250.00 BOB: faltan 150.00 BOB para el mínimo'
  - 'Con 450.00 BOB: mínimo cumplido'
  - 'La línea no tiene umbrales'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-015 — Un presupuesto mínimo informa cuánto falta y cuándo se cumple

## Intención

FR-PLANNING-019 (Should): gasto o aporte mínimo esperado.

## Escenario

```gherkin
Dado "Educación" con mínimo 400.00 BOB
Cuando el gastado es 250.00 BOB
Entonces faltan 150.00 BOB
Cuando el gastado es 450.00 BOB
Entonces el mínimo está cumplido
```

## Notas

