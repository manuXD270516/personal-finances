---
id: TC-PLANNING-TEMPLATE-003
title: 'Una modificación basada en una versión vieja se rechaza por concurrencia'
spec: planning/budget-templates
related_specs: ['planning/budgets']
requirement: 'Cada modificación del template crea una versión inmutable'
scenario: 'Modificación sobre una versión vieja'
requirement_status: confirmed
fr: ['FR-PLANNING-009']
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
tags: ['templates', 'concurrency']
error_code: CONCURRENCY_CONFLICT
preconditions:
  - '"Mes estándar" con versión 1 (Alquiler fijo 2800.00, Supermercado máximo 1500.00, Salario esperado 8000.00 BOB) y versión 2 (Supermercado 1600.00 BOB, resto igual)'
input:
  baseVersionNo: '1'
steps:
  - 'Publicar una versión con baseVersionNo 1'
expected_result:
  - '409 CONCURRENCY_CONFLICT'
  - 'No existe la versión 3'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-TEMPLATE-003 — Una modificación basada en una versión vieja se rechaza por concurrencia

## Intención

Evita perder cambios de otra edición concurrente del template.

## Escenario

```gherkin
Dado "Mes estándar" en la versión 2
Cuando llega una modificación basada en la versión 1
Entonces se rechaza con CONCURRENCY_CONFLICT
```

## Notas

