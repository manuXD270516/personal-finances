---
id: TC-CLASSIFICATION-ARCHIVE-001
title: "Una categoría archivada conserva sus transacciones y no puede asignarse a nuevas"
spec: classification/categories
related_specs: []
requirement: "Archivado de categorías"
scenario: null
requirement_status: provisional
fr: [FR-CLASSIFICATION-001]
nfr: []
invariants: [INV-019]
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["archive", "reporting"]
error_code: "CATEGORY_ARCHIVED"
preconditions:
  - "Categoría \"Old Gym\" con 3 transacciones que suman 450.00 BOB en 2025"
input:
  archive: "Old Gym"
  then_record:
    amount: "150.00 BOB"
    category: "Old Gym"
    date: "2026-03-01"
steps:
  - "Archivar \"Old Gym\""
  - "Consultar los gastos de 2025 por categoría"
  - "Registrar un nuevo gasto con \"Old Gym\""
  - "Desarchivar \"Old Gym\""
expected_result:
  - "Las 3 transacciones siguen referenciando \"Old Gym\""
  - "El reporte de 2025 muestra \"Old Gym\" = 450.00 BOB (marcada como archivada)"
  - "La nueva asignación se rechaza con CATEGORY_ARCHIVED"
  - "Desarchivar restablece la posibilidad de asignarla"
created: 2026-10-01
updated: 2026-10-01
---

# TC-CLASSIFICATION-ARCHIVE-001 — Una categoría archivada conserva sus transacciones y no puede asignarse a nuevas

## Intención

INV-019: archivar nunca deja transacciones huérfanas ni reescribe el historial.

## Escenario

```gherkin
Dado que la categoría "Old Gym" tiene 3 transacciones
Cuando se archiva la categoría
Entonces las 3 transacciones conservan la categoría "Old Gym"
  Y no puede asignarse a nuevas transacciones
```
