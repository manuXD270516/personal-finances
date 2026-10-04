---
id: TC-CLASSIFICATION-GROUP-002
title: 'Archivar un grupo con categorías activas se rechaza con CATEGORY_GROUP_NOT_EMPTY'
spec: classification/categories
related_specs: []
requirement: 'Archivar un grupo exige que sus categorías estén archivadas'
scenario: 'Grupo con categorías activas'
requirement_status: confirmed
fr: [FR-CLASSIFICATION-006]
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
tags: [categories, groups, archive]
error_code: CATEGORY_GROUP_NOT_EMPTY
preconditions:
- 'Grupo "Vivienda" con la categoría activa "Alquiler"'
- 'Grupo "Grupo Vacío Demo" cuyas categorías están todas archivadas'
input:
  archive_group: 'Vivienda'
  archive_group_ok: 'Grupo Vacío Demo'
steps:
- 'Intentar archivar "Vivienda"'
- 'Archivar "Grupo Vacío Demo"'
expected_result:
- 'Archivar "Vivienda" se rechaza con CATEGORY_GROUP_NOT_EMPTY y el grupo sigue activo'
- 'Archivar "Grupo Vacío Demo" se acepta'
created: 2026-10-04
updated: 2026-10-04
---

# TC-CLASSIFICATION-GROUP-002 — Archivar un grupo con categorías activas se rechaza con CATEGORY_GROUP_NOT_EMPTY

## Intención

Ninguna categoría activa queda colgando de un grupo archivado.

## Escenario

```gherkin
Dado el grupo "Vivienda" con la categoría activa "Alquiler"
Cuando el usuario intenta archivar el grupo
Entonces se rechaza con "CATEGORY_GROUP_NOT_EMPTY"
```

## Notas

- Redactado 2026-10-04 (add-classification 1.3): requirement Should. Automatizado por HTTP contra PostgreSQL real.
