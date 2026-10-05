---
id: TC-PLANNING-TEMPLATE-010
title: 'Un periodo creado automáticamente recibe el plan del template predeterminado'
spec: planning/budget-templates
related_specs: ['planning/budgets', 'planning/financial-periods']
requirement: 'Template por defecto aplicado a los periodos nuevos'
scenario: 'Diciembre creado automáticamente con el predeterminado'
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
tags: ['templates', 'default', 'periods']
error_code: null
preconditions:
  - '"Mes estándar" con versión 1 (Alquiler fijo 2800.00, Supermercado máximo 1500.00, Salario esperado 8000.00 BOB) y versión 2 (Supermercado 1600.00 BOB, resto igual)'
  - '"Mes estándar" predeterminado'
  - 'FixedClock en 2026-11-01'
input:
  job: 'creación automática de periodos (add-financial-periods)'
steps:
  - 'Ejecutar la creación automática que crea "2026-12"'
expected_result:
  - '"2026-12" tiene plan con las líneas de "Mes estándar" versión 2'
  - 'Origen "Mes estándar" versión 2'
  - 'Sin predeterminado, el periodo se crea sin plan'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-TEMPLATE-010 — Un periodo creado automáticamente recibe el plan del template predeterminado

## Intención

Templates aplicados a los periodos nuevos (FR-PLANNING-010 con FR-PLANNING-002).

## Escenario

```gherkin
Dado "Mes estándar" predeterminado con última versión 2
Cuando el 2026-11-01 se crea automáticamente "2026-12"
Entonces "2026-12" tiene un plan con las líneas de la versión 2
```

## Notas

- draft: depende de la creación automática de add-financial-periods y de la pregunta abierta 1 (hook síncrono vs evento).
