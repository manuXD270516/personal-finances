---
id: TC-CLASSIFICATION-DELETE-001
title: "Se rechaza eliminar una categoría referenciada por transacciones"
spec: classification/categories
related_specs: []
requirement: "Archivado de categorías"
scenario: null
requirement_status: provisional
fr: [FR-CLASSIFICATION-001]
nfr: []
invariants: [INV-019]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["archive", "cross-context"]
error_code: "CATEGORY_IN_USE"
preconditions:
  - "Categoría \"Groceries\" referenciada por splits en el esquema transactions"
  - "Categoría \"Unused\" sin referencias"
input:
  - request: "DELETE /api/v1/workspaces/{W1}/categories/{Groceries}"
  - request: "DELETE /api/v1/workspaces/{W1}/categories/{Unused}"
steps: ["Enviar cada DELETE"]
expected_result:
  - "Groceries: 409 problem+json con código CATEGORY_IN_USE, sugiriendo archivar; la categoría y los splits no cambian"
  - "Unused: se permite (204) o se convierte en archivado, según la especificación final"
  - "Después, ningún split referencia una categoría inexistente"
created: 2026-10-01
updated: 2026-10-01
---

# TC-CLASSIFICATION-DELETE-001 — Se rechaza eliminar una categoría referenciada por transacciones

## Intención

No existen FKs entre esquemas (ARCHITECTURE §2), por lo que la protección referencial debe aplicarla la aplicación mediante el contrato de Transactions.

## Escenario

```gherkin
Dado que la categoría "Groceries" es usada por transacciones
Cuando el usuario elimina "Groceries"
Entonces se rechaza con el código "CATEGORY_IN_USE"
```
