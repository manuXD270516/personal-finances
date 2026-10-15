---
id: TC-ACCOUNTS-INSTCATALOG-002
title: "Adoptar entradas del catálogo crea instituciones normales vinculadas y auditadas, sin duplicar"
spec: accounts/institutions
related_specs: []
requirement: "Adopción de instituciones desde el catálogo"
scenario: "Adoptar dos entradas"
requirement_status: confirmed
fr: ["FR-ACCOUNTS-012"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/institution-catalog.api.test.ts
  - apps/web/src/ui/accounts/catalog.test.tsx
  - packages/contexts/accounts/src/application/institution-catalog.service.test.ts
  - packages/contexts/accounts/src/domain/catalog-ref.test.ts
  - packages/contexts/accounts/test/integration/institution-catalog.int.test.ts
  - tests/e2e/specs/institution-catalog.spec.ts
status: automated
regression_suite: false
phase: 5
tags: ["accounts", "institutions", "catalog", "audit"]
error_code: null
preconditions:
  - "Catálogo ficticio BO versión 2026-09-30"
  - "Workspace sin instituciones; usuario EDITOR"
input: {"codes": ["BAD", "BAL"]}
steps:
  - "POST W/institutions/adopt con BAD y BAL"
  - "Repetir la adopción de BAD"
  - "Renombrar la institución de BAD a 'Mi banco'"
expected_result:
  - "Se crean Banco Andino Demo (BANK, BO) y Billetera Altiplano Demo (WALLET_PROVIDER) vinculadas a su código y a la versión 2026-09-30"
  - "Un registro de auditoría con los dos códigos"
  - "La repetición no crea otra institución y la informa en alreadyLinked"
  - "Tras renombrar conserva el vínculo con BAD y el catálogo sigue mostrando Banco Andino Demo"
created: 2026-10-13
updated: 2026-10-15
---

# TC-ACCOUNTS-INSTCATALOG-002 — Adoptar entradas del catálogo crea instituciones normales vinculadas y auditadas, sin duplicar

## Intención

La adopción copia la entrada como institución editable (FR-ACCOUNTS-012) y es idempotente por código.

## Escenario

```gherkin
Dado un workspace sin instituciones
Cuando el EDITOR adopta BAD y BAL
Entonces se crean dos instituciones vinculadas
  Y adoptar BAD otra vez no duplica
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
