---
id: TC-CLASSIFICATION-KIND-001
title: El tipo de una categoría no cambia al moverla y sus totales se conservan
spec: classification/categories
related_specs: []
requirement: El tipo de una categoría es inmutable
scenario: Mover a un grupo de otro tipo
requirement_status: confirmed
fr: [FR-CLASSIFICATION-001]
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/classification/src/domain/domain.test.ts
  - packages/contexts/classification/src/application/classification.service.test.ts
status: automated
regression_suite: true
phase: 1
tags: [categories, kind]
error_code: CATEGORY_KIND_MISMATCH
preconditions:
- Categoría de gasto "Restaurantes" en el grupo "Alimentación" con gastos por 420.00 BOB en marzo de 2026
- Grupo de ingreso "Ingresos laborales" y grupo de gasto "Ocio"
input:
  move_to_income_group: Ingresos laborales
  move_to_expense_group: Ocio
steps:
- Mover "Restaurantes" a "Ingresos laborales"
- Mover "Restaurantes" a "Ocio"
- Consultar el total de "Restaurantes" en marzo de 2026
expected_result:
- El primer movimiento se rechaza con CATEGORY_KIND_MISMATCH y la categoría sigue en "Alimentación"
- El segundo se acepta; la categoría sigue siendo EXPENSE
- El total de "Restaurantes" en marzo de 2026 sigue siendo 420.00 BOB
created: 2026-10-02
updated: 2026-10-03
---

# TC-CLASSIFICATION-KIND-001 — El tipo de una categoría no cambia al moverla y sus totales se conservan

## Intención

El tipo es inmutable para no reinterpretar gastos como ingresos; mover entre grupos del mismo tipo no toca transacciones.

## Escenario

```gherkin
Dado "Restaurantes" con 420.00 BOB en marzo de 2026
Cuando se mueve a un grupo de ingreso
Entonces se rechaza con "CATEGORY_KIND_MISMATCH"
Cuando se mueve al grupo de gasto "Ocio"
Entonces se acepta y el total sigue siendo 420.00 BOB
```
