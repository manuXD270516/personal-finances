---
id: TC-IMPORTS-CSV-007
title: "Con columnas débito y crédito una fila con ambos valores es inválida"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Mapeo manual de columnas"
scenario: "Columnas de débito y crédito"
requirement_status: confirmed
fr: ["FR-IMPORTS-003"]
nfr: []
invariants: ["INV-001"]
priority: high
type: domain
level: import
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/application/imports.service.test.ts
  - packages/contexts/imports/src/domain/row-normalizer.test.ts
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
input: {"mapping":{"amount":{"mode":"DEBIT_CREDIT","debitIndex":2,"creditIndex":3},"decimalSeparator":","}}
steps:
  - "Subir un CSV con columnas Débito y Crédito: fila 3 Débito \"245,30\" Crédito vacío; fila 4 con ambos valores"
  - "Aplicar el mapeo DEBIT_CREDIT"
expected_result:
  - "Fila 3: salida de 245.30 BOB"
  - "Fila 4: inválida con IMPORT_INVALID_AMOUNT"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-007 — Con columnas débito y crédito una fila con ambos valores es inválida

## Intención

Muchos extractos bolivianos traen débito y crédito separados; una fila con ambos es ambigua y no se adivina.

## Escenario

```gherkin
Dado un CSV con columnas Débito y Crédito
Cuando aplico el mapeo débito/crédito
Entonces la fila 3 es una salida de 245.30 BOB
  Y la fila 4 con ambos valores es inválida
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
