---
id: TC-IMPORTS-CSV-009
title: "Un mapeo que apunta a una columna inexistente se rechaza con IMPORT_MAPPING_INVALID"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Mapeo manual de columnas"
scenario: "Columna inexistente"
requirement_status: confirmed
fr: ["FR-IMPORTS-003"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/application/imports.service.test.ts
  - packages/contexts/imports/src/domain/csv-mapping.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["csv-import"]
error_code: IMPORT_MAPPING_INVALID
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"mapping":{"amount":{"mode":"SIGNED","index":7}}}
steps:
  - "Subir un CSV de 3 columnas"
  - "PUT mapping con el monto en la columna 7"
expected_result:
  - "422 IMPORT_MAPPING_INVALID"
  - "La importación sigue en AWAITING_MAPPING"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-009 — Un mapeo que apunta a una columna inexistente se rechaza con IMPORT_MAPPING_INVALID

## Intención

Un mapeo incoherente no debe dejar la importación en un estado intermedio.

## Escenario

```gherkin
Dado un CSV de 3 columnas
Cuando asigno el monto a la columna 7
Entonces el mapeo se rechaza y la importación sigue esperando mapeo
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
