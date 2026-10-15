---
id: TC-ACCOUNTS-INSTCATALOG-001
title: "El catálogo de referencia de un país se consulta con fuente, fecha de corte y filtros"
spec: accounts/institutions
related_specs: []
requirement: "Catálogo de referencia de instituciones por país"
scenario: "Consultar el catálogo de un país"
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
  - packages/contexts/accounts/src/infrastructure/file-institution-catalog.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["accounts", "institutions", "catalog"]
error_code: null
preconditions:
  - "Catálogo ficticio BO versión 2026-09-30 con BAD, CID y BAL"
  - "Workspace sin instituciones; usuario VIEWER"
input: {"country": "BO"}
steps:
  - "GET W/institution-catalog?country=BO"
  - "GET con category de cooperativas"
  - "GET W/institutions"
expected_result:
  - "Tres entradas con código, categoría, tipo y estado ACTIVE; fuente 'Registro Demo', fecha de corte 2026-09-30"
  - "Con el filtro solo aparece Cooperativa Illimani Demo"
  - "El listado de instituciones del workspace sigue vacío"
created: 2026-10-13
updated: 2026-10-15
---

# TC-ACCOUNTS-INSTCATALOG-001 — El catálogo de referencia de un país se consulta con fuente, fecha de corte y filtros

## Intención

FR-ACCOUNTS-012: el catálogo es dato de referencia separado de las instituciones del workspace.

## Escenario

```gherkin
Dado el catálogo ficticio BO con tres entradas
Cuando un VIEWER lo consulta
Entonces recibe las tres con fuente y fecha de corte
  Y el workspace sigue sin instituciones
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
