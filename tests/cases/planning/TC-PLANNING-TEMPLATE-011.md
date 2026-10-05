---
id: TC-PLANNING-TEMPLATE-011
title: 'La creación automática del periodo reintentada no duplica el plan'
spec: planning/budget-templates
related_specs: ['planning/budgets', 'planning/financial-periods']
requirement: 'Template por defecto aplicado a los periodos nuevos'
scenario: 'Creación del periodo reintentada'
requirement_status: provisional
fr: ['FR-PLANNING-010', 'FR-PLANNING-002']
nfr: []
invariants: []
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ['templates', 'default', 'idempotency']
error_code: null
preconditions:
  - 'Estado de TC-PLANNING-TEMPLATE-010'
input:
  runs: '2'
steps:
  - 'Ejecutar dos veces la creación automática de "2026-12"'
expected_result:
  - '"2026-12" tiene un solo plan'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-TEMPLATE-011 — La creación automática del periodo reintentada no duplica el plan

## Intención

FR-PLANNING-002 exige creación idempotente; el plan hereda esa garantía.

## Escenario

```gherkin
Cuando la creación automática de "2026-12" se ejecuta dos veces
Entonces "2026-12" tiene un solo plan
```

## Notas

- draft: ver TC-PLANNING-TEMPLATE-010.
