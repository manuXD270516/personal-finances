---
id: TC-CLASSIFICATION-CATEGORY-001
title: Crear una categoría de gasto con icono y color y rechazar nombre duplicado entre hermanas
spec: classification/categories
related_specs: []
requirement: Creación de categorías con tipo de ingreso o gasto
scenario: Nombre duplicado entre hermanas activas
requirement_status: confirmed
fr: [FR-CLASSIFICATION-001]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/classification/src/application/classification.service.test.ts
  - apps/api/test/api/classification.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: [categories]
error_code: NAME_TAKEN
preconditions:
- Grupo de gasto "Alimentación" activo sin categorías
input:
- create:
    group: Alimentación
    name: Supermercado
    icon: cart
    color: '#2E7D32'
- create:
    group: Alimentación
    name: supermercado
steps:
- Crear "Supermercado"
- Crear "supermercado" en el mismo grupo y nivel
expected_result:
- La primera responde 201 con tipo EXPENSE, icono "cart", color "#2E7D32" y estado activo
- La segunda responde 409 NAME_TAKEN y no se crea categoría
created: 2026-10-02
updated: 2026-10-03
---

# TC-CLASSIFICATION-CATEGORY-001 — Crear una categoría de gasto con icono y color y rechazar nombre duplicado entre hermanas

## Intención

FR-CLASSIFICATION-001: atributos de la categoría y unicidad de nombre entre hermanas activas.

## Escenario

```gherkin
Dado el grupo de gasto "Alimentación"
Cuando el usuario crea "Supermercado" y luego "supermercado" en el mismo nivel
Entonces la primera queda activa con tipo gasto
  Y la segunda se rechaza con "NAME_TAKEN"
```

## Notas

- Mismo nombre bajo otro padre del mismo grupo sí se permite (design.md §5).
