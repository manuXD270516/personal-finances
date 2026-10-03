---
id: TC-CLASSIFICATION-RENAME-001
title: Renombrar una categoría se refleja en el historial sin cambiar transacciones
spec: classification/categories
related_specs: []
requirement: Renombrar una categoría no altera el historial
scenario: Renombrar con historial
requirement_status: confirmed
fr: [FR-CLASSIFICATION-002]
nfr: []
invariants: []
priority: high
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/classification/src/application/classification.service.test.ts
status: automated
regression_suite: true
phase: 1
tags: [categories, reporting]
error_code: null
preconditions:
- Categoría "Super" con gastos por 320.50 BOB en marzo de 2026
input:
  rename:
    from: Super
    to: Supermercado
steps:
- Renombrar la categoría
- Consultar el reporte de marzo de 2026 por categoría
- Comparar las porciones antes/después
expected_result:
- El reporte muestra "Supermercado" = 320.50 BOB
- Ninguna porción cambia de categoryId ni de monto
- La auditoría registra el nombre anterior y el nuevo
created: 2026-10-02
updated: 2026-10-03
---

# TC-CLASSIFICATION-RENAME-001 — Renombrar una categoría se refleja en el historial sin cambiar transacciones

## Intención

Las transacciones referencian por ID: renombrar no reescribe historia (FR-CLASSIFICATION-002).

## Escenario

```gherkin
Dada "Super" con 320.50 BOB en marzo de 2026
Cuando se renombra a "Supermercado"
Entonces el reporte de marzo muestra "Supermercado" = 320.50 BOB
  Y ninguna transacción cambia
```
