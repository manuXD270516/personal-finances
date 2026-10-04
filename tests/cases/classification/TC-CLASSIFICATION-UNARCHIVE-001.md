---
id: TC-CLASSIFICATION-UNARCHIVE-001
title: 'Desarchivar una categoría la vuelve asignable; padre archivado o nombre ocupado lo impiden'
spec: classification/categories
related_specs: []
requirement: 'Desarchivar una categoría'
scenario: 'Categoría desarchivada'
requirement_status: confirmed
fr: [FR-CLASSIFICATION-001]
nfr: []
invariants: [INV-019]
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/classification-should.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: [categories, archive]
error_code: CATEGORY_ARCHIVED
preconditions:
- 'Categoría de gasto "Old Gym" archivada'
- 'Subcategoría "Yoga" archivada junto con su padre "Deportes Demo" (archivado en cascada)'
- 'Cuenta "Banco BOB" activa'
input:
  unarchive: 'Old Gym'
  expense: '150.00 BOB en Old Gym'
  unarchive_child_with_archived_parent: 'Yoga'
  unarchive_name_taken: 'Old Gym archivada con una hermana activa del mismo nombre'
steps:
- 'Desarchivar "Old Gym" y registrar un gasto de 150.00 BOB en ella'
- 'Intentar desarchivar "Yoga" con su padre archivado'
- 'Archivar "Old Gym", crear otra "Old Gym" activa e intentar desarchivar la primera'
expected_result:
- 'El gasto se acepta con la categoría "Old Gym"'
- 'Desarchivar "Yoga" se rechaza con CATEGORY_ARCHIVED'
- 'Desarchivar la "Old Gym" duplicada se rechaza con NAME_TAKEN'
created: 2026-10-04
updated: 2026-10-04
---

# TC-CLASSIFICATION-UNARCHIVE-001 — Desarchivar una categoría la vuelve asignable; padre archivado o nombre ocupado lo impiden

## Intención

Desarchivar devuelve una categoría al uso sin romper la jerarquía (ninguna subcategoría activa bajo un padre archivado) ni la unicidad de nombres entre hermanas.

## Escenario

```gherkin
Dada la categoría archivada "Old Gym"
Cuando el usuario la desarchiva
  Y registra un gasto de 150.00 BOB en ella
Entonces el gasto se acepta con la categoría "Old Gym"
```

## Notas

- Redactado 2026-10-04 (add-classification 1.3): requirement Should. Automatizado por HTTP contra PostgreSQL real.
