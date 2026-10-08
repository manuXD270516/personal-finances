---
id: TC-PLANNING-BUDGET-016
title: 'Un presupuesto de rango informa debajo, dentro o encima con umbrales sobre el máximo'
spec: planning/budgets
related_specs: []
requirement: 'Presupuesto de tipo rango'
scenario: 'Rango de supermercado'
requirement_status: confirmed
fr: ['FR-PLANNING-019']
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/planning/src/domain/budget-progress-calculator.test.ts
status: automated
regression_suite: false
phase: 2
tags: ['budgets', 'range']
error_code: null
preconditions:
  - '"Supermercado" con rango 1200.00 a 1500.00 BOB'
input:
  actuals: ['1100.00 BOB', '1350.00 BOB', '1550.00 BOB']
steps:
  - 'Calcular el progreso para cada gastado'
expected_result:
  - '1100.00 BOB ⇒ por debajo'
  - '1350.00 BOB ⇒ dentro (90.0 % del máximo)'
  - '1550.00 BOB ⇒ por encima con exceso 50.00 BOB'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-016 — Un presupuesto de rango informa debajo, dentro o encima con umbrales sobre el máximo

## Intención

FR-PLANNING-019 (Should): rango min–max; los umbrales usan el máximo como referencia (design.md decisión 3).

## Escenario

```gherkin
Dado "Supermercado" con rango 1200.00–1500.00 BOB
Cuando el gastado es 1100.00, 1350.00 o 1550.00 BOB
Entonces el estado es por debajo, dentro o por encima con exceso 50.00 BOB
```

## Notas

