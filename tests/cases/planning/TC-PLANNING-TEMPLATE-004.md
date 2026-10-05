---
id: TC-PLANNING-TEMPLATE-004
title: 'El plan creado desde un template sin versión usa la última y guarda su origen'
spec: planning/budget-templates
related_specs: ['planning/budgets']
requirement: 'Crear el plan de un periodo desde un template'
scenario: 'Plan desde la última versión'
requirement_status: provisional
fr: ['FR-PLANNING-010', 'FR-PLANNING-009']
nfr: []
invariants: []
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['templates', 'apply', 'traceability']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB y TZ America/La_Paz (FixedClock)'
  - '"Mes estándar" con versión 1 (Alquiler fijo 2800.00, Supermercado máximo 1500.00, Salario esperado 8000.00 BOB) y versión 2 (Supermercado 1600.00 BOB, resto igual)'
  - 'Periodo "2026-11" sin plan'
input:
  periodId: '2026-11'
  templateId: 'Mes estándar'
  versionNo: '(omitida)'
steps:
  - 'Crear el plan de "2026-11" desde "Mes estándar" sin versión'
  - 'Publicar luego la versión 3 del template'
  - 'Consultar el plan'
expected_result:
  - 'El plan tiene "Supermercado" 1600.00, "Alquiler" 2800.00 y "Salario" esperado 8000.00 BOB'
  - 'El plan indica origen "Mes estándar" versión 2, también después de existir la versión 3'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-TEMPLATE-004 — El plan creado desde un template sin versión usa la última y guarda su origen

## Intención

FR-PLANNING-010 + FR-PLANNING-009: trazabilidad del plan a la versión de la que nació.

## Escenario

```gherkin
Dado "Mes estándar" con versiones 1 y 2
Cuando creo el plan de "2026-11" desde "Mes estándar" sin indicar versión
Entonces el plan copia la versión 2 y la indica como origen
```

## Notas

