---
id: TC-CLASSIFICATION-HIERARCHY-001
title: Las subcategorías heredan grupo y tipo y no se permite un tercer nivel
spec: classification/categories
related_specs: []
requirement: Jerarquía de dos niveles
scenario: Tercer nivel rechazado
requirement_status: confirmed
fr: [FR-CLASSIFICATION-001]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [categories, hierarchy]
error_code: CATEGORY_DEPTH_EXCEEDED
preconditions:
- Categoría de gasto "Servicios básicos" en el grupo "Vivienda"
input:
  create_sub:
    parent: Servicios básicos
    name: Luz
  create_third_level:
    parent: Luz
    name: Luz departamento
steps:
- Crear "Luz" bajo "Servicios básicos"
- Crear "Luz departamento" bajo "Luz"
expected_result:
- '"Luz" queda activa con tipo EXPENSE y grupo "Vivienda"'
- '"Luz departamento" se rechaza con CATEGORY_DEPTH_EXCEEDED'
created: 2026-10-02
updated: 2026-10-02
---

# TC-CLASSIFICATION-HIERARCHY-001 — Las subcategorías heredan grupo y tipo y no se permite un tercer nivel

## Intención

Máximo dos niveles de categoría (FR-CLASSIFICATION-001); la subcategoría hereda grupo y tipo.

## Escenario

```gherkin
Dado "Servicios básicos" en el grupo "Vivienda"
Cuando se crea "Luz" bajo ella y luego "Luz departamento" bajo "Luz"
Entonces "Luz" hereda grupo y tipo
  Y el tercer nivel se rechaza con "CATEGORY_DEPTH_EXCEEDED"
```

## Notas

- Crear una subcategoría bajo un padre archivado debe rechazarse con CATEGORY_ARCHIVED (caso borde).
