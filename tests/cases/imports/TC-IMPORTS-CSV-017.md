---
id: TC-IMPORTS-CSV-017
title: "Un archivo que se solapa con uno ya importado crea solo las filas nuevas"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Idempotencia por fila"
scenario: "Rangos solapados"
requirement_status: confirmed
fr: ["FR-IMPORTS-010","FR-IMPORTS-007"]
nfr: []
invariants: ["INV-014"]
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/application/imports.service.test.ts
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
input: {"files":["1-15-octubre.csv (10 filas)","octubre-completo.csv (25 filas)"]}
steps:
  - "Importar 1-15-octubre.csv"
  - "Subir y mapear octubre-completo.csv"
  - "Aprobar"
expected_result:
  - "Vista previa: 10 ya importadas, 15 nuevas"
  - "Se crean 15 transacciones"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-017 — Un archivo que se solapa con uno ya importado crea solo las filas nuevas

## Intención

docs/13 §7.4: importar el mes completo tras la primera quincena no duplica la quincena.

## Escenario

```gherkin
Dada la primera quincena importada
Cuando importo el mes completo
Entonces solo se crean las 15 filas nuevas
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
