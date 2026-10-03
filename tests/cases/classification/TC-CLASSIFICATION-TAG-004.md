---
id: TC-CLASSIFICATION-TAG-004
title: Un tag archivado no puede añadirse a transacciones nuevas
spec: classification/tags
related_specs: [transactions/transaction-recording]
requirement: Un tag archivado no es asignable
scenario: Asignar un tag archivado
requirement_status: confirmed
fr: [FR-CLASSIFICATION-008]
nfr: []
invariants: [INV-019]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/classification/src/application/classification.service.test.ts
status: automated
regression_suite: true
phase: 1
tags: [tags, archive]
error_code: TAG_ARCHIVED
preconditions:
- Tag "Viaje Santa Cruz 2026" archivado
input:
  record:
    amount: '95.00'
    currency: BOB
    category: Restaurantes
    tags:
    - Viaje Santa Cruz 2026
steps:
- Registrar el gasto
- Listar tags sin includeArchived
expected_result:
- El gasto se rechaza con TAG_ARCHIVED
- El tag no aparece en el listado por defecto
created: 2026-10-02
updated: 2026-10-03
---

# TC-CLASSIFICATION-TAG-004 — Un tag archivado no puede añadirse a transacciones nuevas

## Intención

Los tags archivados no se ofrecen ni se asignan.

## Escenario

```gherkin
Dado el tag archivado "Viaje Santa Cruz 2026"
Cuando se registra un gasto de 95.00 BOB con ese tag
Entonces se rechaza con "TAG_ARCHIVED"
```
