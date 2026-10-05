---
id: TC-PLANNING-THRESHOLD-001
title: 'Una línea nueva de gasto recibe los umbrales 50, 75, 90 y 100 por defecto'
spec: planning/budgets
related_specs: []
requirement: 'Umbrales de alerta por línea'
scenario: 'Umbrales por defecto'
requirement_status: provisional
fr: ['FR-PLANNING-022']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['budgets', 'thresholds']
error_code: null
preconditions:
  - 'Periodo "2026-11" (2026-11-01 a 2026-11-30) en estado activo con plan en BOB'
input:
  line: 'Restaurantes MAXIMUM 600.00 BOB sin umbrales'
steps:
  - 'Agregar la línea'
expected_result:
  - 'La línea tiene los umbrales 50, 75, 90 y 100 %'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-THRESHOLD-001 — Una línea nueva de gasto recibe los umbrales 50, 75, 90 y 100 por defecto

## Intención

FR-PLANNING-022: umbrales por defecto.

## Escenario

```gherkin
Cuando agrego "Restaurantes" con máximo 600.00 BOB sin umbrales
Entonces tiene los umbrales 50, 75, 90 y 100 %
```

## Notas

