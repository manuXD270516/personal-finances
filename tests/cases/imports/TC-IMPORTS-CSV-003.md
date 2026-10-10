---
id: TC-IMPORTS-CSV-003
title: "Un CSV de 2.5 MiB se rechaza con 413 UPLOAD_TOO_LARGE sin crear la importación"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Límites de tamaño y contenido del archivo"
scenario: "Archivo demasiado grande"
requirement_status: confirmed
fr: ["FR-IMPORTS-003"]
nfr: ["NFR-SEC-012"]
invariants: []
priority: high
type: security
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/application/imports.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["csv-import","limits"]
error_code: UPLOAD_TOO_LARGE
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"sizeBytes":2621440}
steps:
  - "POST W/imports con un archivo de 2.5 MiB (límite IMPORT_CSV_MAX_BYTES = 2 MiB)"
expected_result:
  - "413 UPLOAD_TOO_LARGE"
  - "El servidor deja de leer al superar el límite (no bufferiza el archivo completo)"
  - "No existe ninguna importación nueva"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-003 — Un CSV de 2.5 MiB se rechaza con 413 UPLOAD_TOO_LARGE sin crear la importación

## Intención

Acotar memoria y abuso: el límite se aplica antes de bufferizar (NFR-SEC-012).

## Escenario

```gherkin
Cuando subo un CSV de 2.5 MiB
Entonces la respuesta es 413 UPLOAD_TOO_LARGE
  Y no se crea ninguna importación
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
