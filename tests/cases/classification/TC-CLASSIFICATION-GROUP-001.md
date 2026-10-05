---
id: TC-CLASSIFICATION-GROUP-001
title: 'El total de un grupo de categorías suma los montos de sus categorías en el mes'
spec: classification/categories
related_specs: []
requirement: 'Grupos de categorías'
scenario: 'Total por grupo'
requirement_status: confirmed
fr: [FR-CLASSIFICATION-006]
nfr: []
invariants: []
priority: low
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: [categories, groups, reporting]
error_code: null
preconditions:
- 'Grupo "Vivienda" con "Alquiler" (2,800.00 BOB) y "Servicios básicos" (310.00 BOB) en marzo de 2026'
input:
  month: '2026-03'
  group: 'Vivienda'
steps:
- 'Consultar el total del grupo "Vivienda" en marzo de 2026'
expected_result:
- 'El total del grupo "Vivienda" es 3,110.00 BOB'
created: 2026-10-04
updated: 2026-10-04
---

# TC-CLASSIFICATION-GROUP-001 — El total de un grupo de categorías suma los montos de sus categorías en el mes

## Intención

Los reportes pueden agregar por grupo (FR-CLASSIFICATION-006); el total del grupo es la suma de sus categorías sin doble conteo.

## Escenario

```gherkin
Dado el grupo "Vivienda" con "Alquiler" 2,800.00 BOB y "Servicios básicos" 310.00 BOB en marzo de 2026
Cuando se consulta el total del grupo en marzo de 2026
Entonces es 3,110.00 BOB
```

## Notas

- Redactado 2026-10-04 (add-classification 1.3). Se mantiene `not_automated`: Phase 1 no expone un reporte por grupo (el requirement dice que los reportes PUEDEN agregar por grupo; `reports/summary` agrega por categoría). Se automatiza cuando Reporting agregue por grupo.
