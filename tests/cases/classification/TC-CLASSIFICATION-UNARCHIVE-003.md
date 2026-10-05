---
id: TC-CLASSIFICATION-UNARCHIVE-003
title: 'Desarchivar una counterparty la vuelve asignable; un nombre ocupado lo impide'
spec: classification/counterparties
related_specs: []
requirement: 'Desarchivar una counterparty'
scenario: 'Counterparty desarchivada'
requirement_status: confirmed
fr: [FR-CLASSIFICATION-010]
nfr: []
invariants: [INV-019]
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/classification-should.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: [counterparties, archive]
error_code: NAME_TAKEN
preconditions:
- 'Counterparty "Entel" archivada'
- 'Cuenta "Banco BOB" activa'
input:
  unarchive: 'Entel'
  expense: '120.00 BOB con la counterparty Entel'
  unarchive_name_taken: 'counterparty archivada con otra activa del mismo nombre'
steps:
- 'Desarchivar "Entel" y registrar un gasto de 120.00 BOB con ella'
- 'Archivarla, crear otra "Entel" activa e intentar desarchivar la primera'
expected_result:
- 'El gasto se acepta con la counterparty "Entel"'
- 'El desarchivado con nombre ocupado se rechaza con NAME_TAKEN'
created: 2026-10-04
updated: 2026-10-04
---

# TC-CLASSIFICATION-UNARCHIVE-003 — Desarchivar una counterparty la vuelve asignable; un nombre ocupado lo impide

## Intención

Una counterparty archivada vuelve a ser asignable (y reconocible por sus alias) sin duplicar nombres activos.

## Escenario

```gherkin
Dada la counterparty archivada "Entel"
Cuando el usuario la desarchiva
  Y registra un gasto de 120.00 BOB con ella
Entonces el gasto se acepta con la counterparty "Entel"
```

## Notas

- Redactado 2026-10-04 (add-classification 1.3): requirement Should. Automatizado por HTTP contra PostgreSQL real.
