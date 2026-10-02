---
id: TC-CLASSIFICATION-ARCHIVE-003
title: Archivar una categoría archiva sus subcategorías sin tocar sus transacciones
spec: classification/categories
related_specs: []
requirement: Archivar una categoría archiva sus subcategorías
scenario: Archivado en cascada
requirement_status: confirmed
fr: [FR-CLASSIFICATION-002]
nfr: []
invariants: [INV-019]
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [archive, hierarchy]
error_code: null
preconditions:
- '"Servicios básicos" con subcategorías activas "Luz" y "Agua"'
- Transacciones de "Luz" por 180.00 BOB en febrero de 2026
input:
  archive: Servicios básicos
steps:
- Archivar "Servicios básicos"
- Consultar estado de las tres categorías
- Consultar transacciones de "Luz"
expected_result:
- '"Servicios básicos", "Luz" y "Agua" quedan archivadas en la misma operación'
- Las transacciones de "Luz" (180.00 BOB) siguen referenciando "Luz"
- Se emite un classification.CategoryArchived.v1 por cada categoría archivada
created: 2026-10-02
updated: 2026-10-02
---

# TC-CLASSIFICATION-ARCHIVE-003 — Archivar una categoría archiva sus subcategorías sin tocar sus transacciones

## Intención

Ninguna subcategoría activa puede colgar de un padre archivado.

## Escenario

```gherkin
Dado "Servicios básicos" con subcategorías "Luz" y "Agua"
Cuando se archiva "Servicios básicos"
Entonces las tres quedan archivadas
  Y las transacciones de "Luz" por 180.00 BOB conservan su categoría
```
