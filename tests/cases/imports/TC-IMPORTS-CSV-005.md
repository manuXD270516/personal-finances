---
id: TC-IMPORTS-CSV-005
title: "Una imagen renombrada como CSV se rechaza con IMPORT_UNSUPPORTED_FORMAT"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Límites de tamaño y contenido del archivo"
scenario: "Imagen renombrada como CSV"
requirement_status: provisional
fr: ["FR-IMPORTS-003"]
nfr: ["NFR-SEC-012"]
invariants: []
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ["csv-import","limits"]
error_code: IMPORT_UNSUPPORTED_FORMAT
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"file":"tests/fixtures/imports/csv/edge/png-renamed.csv"}
steps:
  - "POST W/imports con un PNG llamado extracto.csv"
expected_result:
  - "422 IMPORT_UNSUPPORTED_FORMAT (contenido binario)"
  - "No existe ninguna importación nueva"
created: 2026-10-09
updated: 2026-10-09
---

# TC-IMPORTS-CSV-005 — Una imagen renombrada como CSV se rechaza con IMPORT_UNSUPPORTED_FORMAT

## Intención

Se valida el contenido, no la extensión (docs/13 §4.1).

## Escenario

```gherkin
Cuando subo una imagen PNG renombrada a extracto.csv
Entonces se rechaza con IMPORT_UNSUPPORTED_FORMAT
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
