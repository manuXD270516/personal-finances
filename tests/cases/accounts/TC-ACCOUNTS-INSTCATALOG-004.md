---
id: TC-ACCOUNTS-INSTCATALOG-004
title: "Un nombre ya usado por una institución propia se informa como conflicto sin impedir las demás"
spec: accounts/institutions
related_specs: []
requirement: "Adopción de instituciones desde el catálogo"
scenario: "Nombre ya usado por una institución propia"
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
  - apps/web/src/ui/accounts/catalog.test.tsx
  - packages/contexts/accounts/src/application/institution-catalog.service.test.ts
  - packages/contexts/accounts/src/domain/catalog-ref.test.ts
  - packages/contexts/accounts/test/integration/institution-catalog.int.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["accounts", "institutions", "catalog"]
error_code: "NAME_TAKEN"
preconditions:
  - "Workspace con 'Banco Andino Demo' creada a mano sin vínculo"
  - "Usuario EDITOR"
input: {"codes": ["BAD", "CID"]}
steps:
  - "POST W/institutions/adopt con BAD y CID"
  - "POST con links [{code: BAD, institutionId: <existente>}]"
expected_result:
  - "Se crea Cooperativa Illimani Demo vinculada a CID"
  - "BAD aparece en conflicts con NAME_TAKEN y el id de la existente"
  - "Con links la institución existente queda vinculada a BAD sin crear otra"
created: 2026-10-13
updated: 2026-10-15
---

# TC-ACCOUNTS-INSTCATALOG-004 — Un nombre ya usado por una institución propia se informa como conflicto sin impedir las demás

## Intención

Respeta la unicidad de nombre activo (TC-ACCOUNTS-INSTITUTION-004) sin bloquear la adopción.

## Escenario

```gherkin
Dado Banco Andino Demo creada a mano
Cuando el EDITOR adopta BAD y CID
Entonces se crea CID
  Y BAD se informa como conflicto
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
