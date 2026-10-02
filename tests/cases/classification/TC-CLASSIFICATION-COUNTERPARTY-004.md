---
id: TC-CLASSIFICATION-COUNTERPARTY-004
title: Una counterparty archivada no puede asignarse a transacciones nuevas
spec: classification/counterparties
related_specs: [transactions/transaction-recording]
requirement: Una counterparty archivada no es asignable
scenario: Asignar una counterparty archivada
requirement_status: confirmed
fr: [FR-CLASSIFICATION-010]
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
tags: [counterparties, archive]
error_code: COUNTERPARTY_ARCHIVED
preconditions:
- Counterparty "Entel" archivada
input:
  record:
    amount: '120.00'
    currency: BOB
    category: Telefonía móvil
    counterparty: Entel
steps:
- Registrar el gasto
- Listar counterparties sin includeArchived
expected_result:
- El gasto se rechaza con COUNTERPARTY_ARCHIVED
- '"Entel" no aparece en el listado por defecto'
created: 2026-10-02
updated: 2026-10-02
---

# TC-CLASSIFICATION-COUNTERPARTY-004 — Una counterparty archivada no puede asignarse a transacciones nuevas

## Intención

Las counterparties archivadas no se ofrecen ni se asignan.

## Escenario

```gherkin
Dada la counterparty archivada "Entel"
Cuando se registra un gasto de 120.00 BOB con ella
Entonces se rechaza con "COUNTERPARTY_ARCHIVED"
```
