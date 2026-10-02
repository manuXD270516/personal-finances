---
id: TC-CLASSIFICATION-DELETE-001
title: 'No existe eliminación de categorías: la solicitud se rechaza y nada cambia'
spec: classification/categories
related_specs: [transactions/splits]
requirement: Las categorías se archivan en lugar de eliminarse
scenario: Intento de eliminar una categoría usada
requirement_status: confirmed
fr: [FR-CLASSIFICATION-002]
nfr: []
invariants: [INV-019]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [archive, cross-context]
error_code: null
preconditions:
- Categoría "Supermercado" referenciada por porciones que suman 1,240.00 BOB
- Categoría "Sin uso" sin referencias
input:
- request: DELETE /api/v1/workspaces/{W1}/categories/{Supermercado}
- request: DELETE /api/v1/workspaces/{W1}/categories/{SinUso}
steps:
- Enviar cada DELETE
- Consultar ambas categorías y las porciones de "Supermercado"
expected_result:
- Ambas solicitudes responden 405 problem+json; ninguna categoría cambia de estado ni de datos
- Las porciones que suman 1,240.00 BOB siguen referenciando "Supermercado"
- Ninguna porción referencia una categoría inexistente
- La operación disponible para retirar una categoría es POST …/archive
created: 2026-10-01
updated: 2026-10-02
---

# TC-CLASSIFICATION-DELETE-001 — No existe eliminación de categorías: la solicitud se rechaza y nada cambia

## Intención

INV-019 y docs/10 §3: nunca DELETE sobre datos financieros; el único retiro es el archivado. No hay FKs entre esquemas (ARCHITECTURE §2), por lo que la protección referencial no puede depender de la BD.

## Escenario

```gherkin
Dado que la categoría "Supermercado" es usada por transacciones que suman 1,240.00 BOB
Cuando el usuario solicita eliminar "Supermercado"
Entonces la solicitud se rechaza sin cambios
  Y todas las porciones siguen referenciando una categoría existente
```

## Notas

- Cambio respecto del borrador: ya no se espera CATEGORY_IN_USE ni borrado de categorías sin uso (design.md §3).
