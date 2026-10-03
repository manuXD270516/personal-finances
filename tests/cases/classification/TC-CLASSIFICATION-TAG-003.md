---
id: TC-CLASSIFICATION-TAG-003
title: Archivar un tag conserva las transacciones que lo tienen
spec: classification/tags
related_specs: []
requirement: Los tags se archivan en lugar de eliminarse
scenario: Archivar un tag con historial
requirement_status: confirmed
fr: [FR-CLASSIFICATION-008]
nfr: []
invariants: [INV-019]
priority: high
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/classification/src/domain/domain.test.ts
  - packages/contexts/classification/test/integration/pg-classification.int.test.ts
status: automated
regression_suite: true
phase: 1
tags: [tags, archive]
error_code: null
preconditions:
- Tag "Viaje Santa Cruz 2026" en 4 gastos que suman 1,180.00 BOB
input:
  archive: Viaje Santa Cruz 2026
  delete_request: DELETE /api/v1/workspaces/{W1}/tags/{T}
steps:
- Enviar el DELETE
- Archivar el tag
- Consultar los 4 gastos y el reporte por tag
expected_result:
- El DELETE responde 405 y nada cambia
- Los 4 gastos conservan el tag
- El reporte por tag muestra "Viaje Santa Cruz 2026" = 1,180.00 BOB como archivado
created: 2026-10-02
updated: 2026-10-03
---

# TC-CLASSIFICATION-TAG-003 — Archivar un tag conserva las transacciones que lo tienen

## Intención

INV-019 aplicado a tags: solo soft-archive.

## Escenario

```gherkin
Dado el tag "Viaje Santa Cruz 2026" en 4 gastos por 1,180.00 BOB
Cuando se archiva
Entonces los 4 gastos conservan el tag
  Y el reporte lo muestra archivado con 1,180.00 BOB
```
