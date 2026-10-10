---
id: TC-IMPORTS-CSV-019
title: "Volver a subir el mismo archivo advierte que ya fue importado sin bloquear"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Aviso de archivo ya importado"
scenario: "Re-subida del mismo archivo"
requirement_status: confirmed
fr: ["FR-IMPORTS-010"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/application/imports.service.test.ts
  - packages/contexts/imports/test/integration/pg-imports.int.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["csv-import"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"file":"extracto-octubre.csv"}
steps:
  - "Importar extracto-octubre.csv el 2026-10-20"
  - "Subirlo de nuevo para Banco BOB"
expected_result:
  - "201 con warnings[] = IMPORT_FILE_ALREADY_IMPORTED, fecha 2026-10-20 e id de la importación anterior"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-019 — Volver a subir el mismo archivo advierte que ya fue importado sin bloquear

## Intención

docs/13 §7.1: el checksum avisa al usuario; la idempotencia por fila garantiza que no haya duplicados.

## Escenario

```gherkin
Dado extracto-octubre.csv importado el 2026-10-20
Cuando lo subo otra vez
Entonces la importación se crea con la advertencia IMPORT_FILE_ALREADY_IMPORTED
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
