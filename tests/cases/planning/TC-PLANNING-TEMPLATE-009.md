---
id: TC-PLANNING-TEMPLATE-009
title: 'Clonar cuando el periodo anterior no tiene plan se rechaza'
spec: planning/budget-templates
related_specs: ['planning/budgets']
requirement: 'Crear el plan clonando el plan del periodo anterior'
scenario: 'Periodo anterior sin plan'
requirement_status: provisional
fr: ['FR-PLANNING-011']
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['templates', 'clone']
error_code: REFERENCE_NOT_FOUND
preconditions:
  - '"2026-12" sin plan'
  - '"2027-01" sin plan'
input:
  periodId: '2027-01'
  source: 'CLONE_PREVIOUS'
steps:
  - 'Crear el plan de "2027-01" clonando el anterior'
expected_result:
  - '422 REFERENCE_NOT_FOUND'
  - '"2027-01" sigue sin plan'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-TEMPLATE-009 — Clonar cuando el periodo anterior no tiene plan se rechaza

## Intención

No se inventa un plan vacío en silencio cuando el usuario pidió clonar.

## Escenario

```gherkin
Dado "2026-12" sin plan
Cuando creo el plan de "2027-01" clonando el anterior
Entonces se rechaza con REFERENCE_NOT_FOUND
```

## Notas

