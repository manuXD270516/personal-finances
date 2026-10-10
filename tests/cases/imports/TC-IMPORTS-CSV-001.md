---
id: TC-IMPORTS-CSV-001
title: "Subir un extracto CSV detecta codificación, delimitador y columnas sin crear transacciones"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Importación CSV para una cuenta"
scenario: "Subida de un extracto"
requirement_status: provisional
fr: ["FR-IMPORTS-003","FR-IMPORTS-001"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ["csv-import"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"file":"tests/fixtures/imports/csv/extracto-octubre/input.csv","accountId":"Banco BOB"}
steps:
  - "POST W/imports (multipart) con extracto-octubre.csv (windows-1252, ';', encabezado Fecha;Descripción;Monto, 4 filas)"
expected_result:
  - "201 con status AWAITING_MAPPING"
  - "detected.encoding = windows-1252, detected.delimiter = ';'"
  - "header = [Fecha, Descripción, Monto]; sampleRows con 4 filas"
  - "Ninguna transacción nueva en Banco BOB"
created: 2026-10-09
updated: 2026-10-09
---

# TC-IMPORTS-CSV-001 — Subir un extracto CSV detecta codificación, delimitador y columnas sin crear transacciones

## Intención

FR-IMPORTS-003: el primer paso solo lee y muestra el archivo para mapearlo; nada financiero ocurre (NFR-DATA-016).

## Escenario

```gherkin
Dado el archivo extracto-octubre.csv en windows-1252 con punto y coma
Cuando lo subo para Banco BOB
Entonces la importación espera mapeo con codificación, delimitador, columnas y 4 filas de muestra
  Y no se crea ninguna transacción
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
