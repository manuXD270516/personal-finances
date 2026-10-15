---
id: TC-IDENTITY-EXPORT-014
title: "El export conserva el vínculo con el catálogo y las tasas por institución sin consultar fuentes"
spec: identity/workspace-portability
related_specs: []
requirement: "Vínculo con el catálogo de referencia en el export"
scenario: "Ida y vuelta con una institución adoptada y renombrada"
requirement_status: confirmed
fr: ["FR-IDENTITY-010", "FR-IDENTITY-017", "FR-ACCOUNTS-012"]
nfr: []
invariants: ["INV-011"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/institution-catalog.api.test.ts
  - apps/api/test/api/workspace-export-institutions.api.test.ts
  - packages/contexts/accounts/src/application/institution-catalog.service.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["identity", "export", "institutions", "bank-rates"]
error_code: null
preconditions:
  - "W1 adoptó BAD y la renombró a 'Mi banco'"
  - "30 tasas USD/BOB BANK_SELL de BAD"
input: {"rates": 30}
steps:
  - "Exportar e importar W1"
  - "Importar en una instalación cuyo catálogo no tiene BAD"
expected_result:
  - "'Mi banco' vinculada a BAD con la misma versión; las 30 tasas con código BAD, mismos valores y vigencias"
  - "Ninguna solicitud a proveedores"
  - "Sin BAD en el catálogo destino la institución se importa igual y se informa 'no figura en el catálogo de esta instalación'"
created: 2026-10-13
updated: 2026-10-15
---

# TC-IDENTITY-EXPORT-014 — El export conserva el vínculo con el catálogo y las tasas por institución sin consultar fuentes

## Intención

La portabilidad incluye las columnas nuevas.

## Escenario

```gherkin
Dado W1 con BAD adoptada y renombrada
Cuando se exporta e importa
Entonces conserva nombre, vínculo y tasas
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
