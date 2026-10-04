---
id: TC-CLASSIFICATION-ORDER-001
title: 'El orden de las subcategorías persiste y se usa en los listados'
spec: classification/categories
related_specs: []
requirement: 'Orden persistente de categorías'
scenario: 'Reordenar subcategorías'
requirement_status: confirmed
fr: [FR-CLASSIFICATION-005]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/classification-should.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: [categories, order]
error_code: VALIDATION_FAILED
preconditions:
- 'Categoría "Servicios básicos" (grupo "Vivienda") del catálogo es-BO con sus subcategorías activas "Luz", "Agua", "Gas domiciliario", "Internet", "Telefonía móvil" y "TV cable", en ese orden'
input:
  reorder: 'Servicios básicos ⇒ Internet, Luz, Agua, Gas domiciliario, Telefonía móvil, TV cable'
  reorder_incompleto: 'Internet, Luz, Agua (faltan las demás hermanas activas)'
steps:
- 'Reordenar las subcategorías'
- 'Listar las categorías'
- 'Reordenar con un conjunto que no es exactamente el de las hermanas activas'
expected_result:
- 'El listado posterior devuelve "Internet", "Luz", "Agua" seguidas de las demás en su orden'
- 'El reordenamiento incompleto se rechaza con VALIDATION_FAILED y el orden no cambia'
created: 2026-10-04
updated: 2026-10-04
---

# TC-CLASSIFICATION-ORDER-001 — El orden de las subcategorías persiste y se usa en los listados

## Intención

El orden elegido por el usuario se guarda en el servidor y es el que usan selectores y listados.

## Escenario

```gherkin
Dadas las subcategorías "Luz", "Agua" e "Internet" (entre otras) de "Servicios básicos"
Cuando el usuario las reordena como "Internet", "Luz", "Agua"
Entonces el listado posterior las devuelve en ese orden
```

## Notas

- Redactado 2026-10-04 (add-classification 1.3): requirement Should. Automatizado por HTTP contra PostgreSQL real.
