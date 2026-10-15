---
id: TC-ACCOUNTS-INSTCATALOG-003
title: "Un código inexistente rechaza toda la adopción sin crear instituciones"
spec: accounts/institutions
related_specs: []
requirement: "Adopción de instituciones desde el catálogo"
scenario: "Código desconocido"
requirement_status: confirmed
fr: ["FR-ACCOUNTS-012"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/institution-catalog.api.test.ts
  - packages/contexts/accounts/src/application/institution-catalog.service.test.ts
  - packages/contexts/accounts/test/integration/institution-catalog.int.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["accounts", "institutions", "catalog"]
error_code: "INSTITUTION_CATALOG_ENTRY_UNKNOWN"
preconditions:
  - "Catálogo ficticio BO sin el código ZZZ"
  - "Usuario EDITOR"
input: {"codes": ["BAD", "ZZZ"]}
steps:
  - "POST W/institutions/adopt con BAD y ZZZ"
  - "Adoptar como VIEWER"
expected_result:
  - "422 INSTITUTION_CATALOG_ENTRY_UNKNOWN y ninguna institución creada"
  - "El VIEWER recibe INSUFFICIENT_ROLE"
created: 2026-10-13
updated: 2026-10-15
---

# TC-ACCOUNTS-INSTCATALOG-003 — Un código inexistente rechaza toda la adopción sin crear instituciones

## Intención

La adopción es atómica frente a códigos inválidos.

## Escenario

```gherkin
Dado un catálogo sin ZZZ
Cuando el EDITOR adopta BAD y ZZZ
Entonces se rechaza
  Y no se crea ninguna institución
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
