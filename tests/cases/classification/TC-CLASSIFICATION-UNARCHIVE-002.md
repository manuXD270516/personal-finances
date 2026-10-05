---
id: TC-CLASSIFICATION-UNARCHIVE-002
title: 'Desarchivar un tag lo vuelve asignable; un nombre ocupado lo impide'
spec: classification/tags
related_specs: []
requirement: 'Desarchivar un tag'
scenario: 'Tag desarchivado'
requirement_status: confirmed
fr: [FR-CLASSIFICATION-008]
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
tags: [tags, archive]
error_code: NAME_TAKEN
preconditions:
- 'Tag "Viaje Santa Cruz 2026" archivado'
- 'Cuenta "Banco BOB" activa'
input:
  unarchive: 'Viaje Santa Cruz 2026'
  expense: '95.00 BOB con el tag Viaje Santa Cruz 2026'
  unarchive_name_taken: 'tag archivado con otro activo del mismo nombre normalizado'
steps:
- 'Desarchivar el tag y registrar un gasto de 95.00 BOB con él'
- 'Archivarlo, crear otro tag activo con el mismo nombre e intentar desarchivar el primero'
expected_result:
- 'El gasto se acepta con el tag'
- 'El desarchivado con nombre ocupado se rechaza con NAME_TAKEN'
created: 2026-10-04
updated: 2026-10-04
---

# TC-CLASSIFICATION-UNARCHIVE-002 — Desarchivar un tag lo vuelve asignable; un nombre ocupado lo impide

## Intención

Un tag archivado puede volver al uso sin duplicar nombres normalizados entre tags activos.

## Escenario

```gherkin
Dado el tag archivado "Viaje Santa Cruz 2026"
Cuando el usuario lo desarchiva
  Y registra un gasto de 95.00 BOB con ese tag
Entonces el gasto se acepta con el tag
```

## Notas

- Redactado 2026-10-04 (add-classification 1.3): requirement Should. Automatizado por HTTP contra PostgreSQL real.
