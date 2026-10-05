---
id: TC-PLANNING-TEMPLATE-005
title: 'El plan puede crearse desde una versión anterior indicada'
spec: planning/budget-templates
related_specs: ['planning/budgets']
requirement: 'Crear el plan de un periodo desde un template'
scenario: 'Plan desde una versión anterior'
requirement_status: provisional
fr: ['FR-PLANNING-010']
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
tags: ['templates', 'apply']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB y TZ America/La_Paz (FixedClock)'
  - '"Mes estándar" con versión 1 (Alquiler fijo 2800.00, Supermercado máximo 1500.00, Salario esperado 8000.00 BOB) y versión 2 (Supermercado 1600.00 BOB, resto igual)'
  - 'Periodo "2026-11" sin plan'
input:
  periodId: '2026-11'
  templateId: 'Mes estándar'
  versionNo: '1'
steps:
  - 'Crear el plan desde la versión 1'
expected_result:
  - '"Supermercado" máximo 1500.00 BOB'
  - 'Origen "Mes estándar" versión 1'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-TEMPLATE-005 — El plan puede crearse desde una versión anterior indicada

## Intención

FR-PLANNING-010: versión específica a elección.

## Escenario

```gherkin
Cuando creo el plan de "2026-11" desde "Mes estándar" versión 1
Entonces "Supermercado" tiene 1500.00 BOB y el origen es la versión 1
```

## Notas

