---
id: TC-ACCOUNTS-INSTCATALOG-005
title: "Una entrada retirada del registro no altera la institución adoptada ni sus cuentas y no se puede adoptar"
spec: accounts/institutions
related_specs: []
requirement: "Entrada retirada del registro oficial"
scenario: "Entidad retirada con cuentas"
requirement_status: confirmed
fr: ["FR-ACCOUNTS-012", "FR-ACCOUNTS-013"]
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/institution-catalog.api.test.ts
  - apps/web/src/ui/accounts/catalog.test.tsx
  - packages/contexts/accounts/src/application/institution-catalog.service.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["accounts", "institutions", "catalog"]
error_code: null
preconditions:
  - "Institución adoptada de BAD asociada a 'Bank A' con saldo 1000.00 BOB"
  - "Versión 2026-12-31 del catálogo con BAD DELISTED"
input: {"catalogVersion": "2026-12-31", "balance": "1000.00"}
steps:
  - "Cargar la versión 2026-12-31"
  - "Consultar la institución y la cuenta"
  - "Adoptar BAD en otro workspace"
expected_result:
  - "La institución sigue activa y vinculada; 'Bank A' conserva 1000.00 BOB"
  - "Se informa 'no figura en el registro desde 2026-12-31'"
  - "La adopción se rechaza con VALIDATION_FAILED"
created: 2026-10-13
updated: 2026-10-15
---

# TC-ACCOUNTS-INSTCATALOG-005 — Una entrada retirada del registro no altera la institución adoptada ni sus cuentas y no se puede adoptar

## Intención

Una entidad intervenida o fusionada no puede romper las cuentas del usuario.

## Escenario

```gherkin
Dado BAD adoptada con una cuenta de 1000.00 BOB
Cuando el catálogo marca BAD como DELISTED
Entonces la cuenta conserva su saldo
  Y BAD ya no se puede adoptar
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
