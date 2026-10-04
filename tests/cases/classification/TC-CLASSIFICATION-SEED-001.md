---
id: TC-CLASSIFICATION-SEED-001
title: El catálogo inicial se carga opcionalmente, es editable y aplicarlo dos veces no duplica
spec: classification/categories
related_specs: []
requirement: Catálogo inicial de categorías opcional y editable
scenario: Aplicar el catálogo dos veces
requirement_status: confirmed
fr: [FR-CLASSIFICATION-004]
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/classification/src/infrastructure/default-catalog.test.ts
  - packages/contexts/classification/test/integration/pg-classification.int.test.ts
  - apps/api/test/api/classification.api.test.ts
  - tests/e2e/specs/classification.spec.ts
status: automated
regression_suite: true
phase: 1
tags: [seed, workspace]
error_code: null
preconditions:
- Usuario autenticado sin workspaces
- Catálogo de datos es-BO.v1 (design.md §7)
input:
  createWorkspace:
    name: Personal
    baseCurrency: BOB
    seedDefaultCategories: true
  then: POST /api/v1/workspaces/{W1}/categories/apply-default-catalog
steps:
- Crear el workspace con catálogo
- Contar grupos y categorías de usuario
- Renombrar "Supermercado" a "Súper" y archivar "Delivery"
- Aplicar el catálogo de nuevo
expected_result:
- 'Tras crear: 13 grupos y 67 categorías/subcategorías de usuario además de las 11 de sistema; "Supermercado" existe en "Alimentación"'
- El renombrado y el archivado se aceptan (son categorías de usuario)
- Reaplicar no crea duplicados de las categorías activas existentes y reporta las omitidas
- Las categorías del catálogo tienen systemCode null
created: 2026-10-02
updated: 2026-10-04
---

# TC-CLASSIFICATION-SEED-001 — El catálogo inicial se carga opcionalmente, es editable y aplicarlo dos veces no duplica

## Intención

FR-CLASSIFICATION-004: seed editable y opcional, nunca hardcodeado.

## Escenario

```gherkin
Dado un workspace creado con el catálogo inicial
Cuando el usuario aplica el catálogo de nuevo
Entonces no se crea ninguna categoría duplicada
```

## Notas

- Comportamiento al reaplicar tras renombrar/archivar: se crea de nuevo solo lo que no existe activo con el mismo nombre en el mismo nivel; documentar el resultado observado al automatizar.
