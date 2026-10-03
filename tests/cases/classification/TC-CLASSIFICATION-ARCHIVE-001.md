---
id: TC-CLASSIFICATION-ARCHIVE-001
title: Una categoría archivada conserva sus transacciones y su total histórico
spec: classification/categories
related_specs: []
requirement: Una categoría archivada conserva su historial
scenario: Reporte histórico con categoría archivada
requirement_status: confirmed
fr: [FR-CLASSIFICATION-002]
nfr: []
invariants: [INV-019]
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/classification/src/application/classification.service.test.ts
  - packages/contexts/classification/test/integration/pg-classification.int.test.ts
status: automated
regression_suite: true
phase: 1
tags: [archive, reporting]
error_code: null
preconditions:
- Categoría "Old Gym" (gasto) con 3 transacciones que suman 450.00 BOB en 2025 (150.00 BOB cada una)
input:
  archive: Old Gym
steps:
- Archivar "Old Gym"
- Consultar las transacciones de "Old Gym"
- Consultar los gastos de 2025 por categoría
expected_result:
- Las 3 transacciones siguen referenciando "Old Gym" con sus montos intactos
- El reporte de 2025 muestra "Old Gym" = 450.00 BOB marcada como archivada
created: 2026-10-01
updated: 2026-10-03
---

# TC-CLASSIFICATION-ARCHIVE-001 — Una categoría archivada conserva sus transacciones y su total histórico

## Intención

INV-019: archivar nunca deja transacciones huérfanas ni reescribe el historial.

## Escenario

```gherkin
Dado que la categoría "Old Gym" tiene 3 transacciones que suman 450.00 BOB en 2025
Cuando se archiva la categoría
Entonces las 3 transacciones conservan la categoría "Old Gym"
  Y el reporte de 2025 muestra "Old Gym" = 450.00 BOB como archivada
```

## Notas

- La no asignabilidad tras archivar se cubre en TC-CLASSIFICATION-ARCHIVE-002; el desarchivado en los TC Should del grupo 1.3.
- Datos: categoría `Old Gym` de la Minimal Seed (docs/29).
