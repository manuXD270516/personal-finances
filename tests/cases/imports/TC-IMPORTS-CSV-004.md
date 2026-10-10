---
id: TC-IMPORTS-CSV-004
title: "Un CSV con 5 001 filas de datos se rechaza con IMPORT_TOO_MANY_ROWS"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Límites de tamaño y contenido del archivo"
scenario: "Demasiadas filas"
requirement_status: confirmed
fr: ["FR-IMPORTS-003"]
nfr: ["NFR-SEC-012"]
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/application/imports.service.test.ts
  - packages/contexts/imports/src/domain/csv-sniffer.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["csv-import","limits"]
error_code: IMPORT_TOO_MANY_ROWS
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"rows":5001,"sizeBytes":1258291}
steps:
  - "POST W/imports con un CSV de 1.2 MiB y 5 001 filas de datos"
expected_result:
  - "422 IMPORT_TOO_MANY_ROWS"
  - "No existe ninguna importación nueva"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-004 — Un CSV con 5 001 filas de datos se rechaza con IMPORT_TOO_MANY_ROWS

## Intención

El límite de filas acota el mapeo síncrono y la ráfaga de eventos (D112).

## Escenario

```gherkin
Cuando subo un CSV con 5 001 filas
Entonces se rechaza con IMPORT_TOO_MANY_ROWS
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
