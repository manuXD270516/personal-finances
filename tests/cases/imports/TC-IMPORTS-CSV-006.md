---
id: TC-IMPORTS-CSV-006
title: "El mapeo con monto con signo convierte las filas en 3 salidas por 281.30 BOB y 1 entrada de 8000.00 BOB"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Mapeo manual de columnas"
scenario: "Monto con signo"
requirement_status: provisional
fr: ["FR-IMPORTS-003"]
nfr: []
invariants: ["INV-001","INV-002"]
priority: critical
type: domain
level: import
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
input: {"mapping":{"hasHeader":true,"columns":{"date":0,"description":1,"amount":{"mode":"SIGNED","index":2,"signConvention":"NEGATIVE_IS_OUTFLOW"}},"dateFormat":"dd/MM/yyyy","decimalSeparator":","}}
steps:
  - "Subir extracto-octubre.csv (-245,30; -18,00; -18,00; 8.000,00)"
  - "PUT W/imports/{id}/mapping con el mapeo del input"
expected_result:
  - "status AWAITING_REVIEW"
  - "3 salidas: 245.30, 18.00, 18.00 BOB (total 281.30 BOB)"
  - "1 entrada: 8000.00 BOB"
created: 2026-10-09
updated: 2026-10-09
---

# TC-IMPORTS-CSV-006 — El mapeo con monto con signo convierte las filas en 3 salidas por 281.30 BOB y 1 entrada de 8000.00 BOB

## Intención

El mapeo manual es el corazón de FR-IMPORTS-003: columnas, signo y moneda de la cuenta.

## Escenario

```gherkin
Dado extracto-octubre.csv subido
Cuando asigno fecha, descripción y monto con signo negativo como salida
Entonces veo 3 salidas por 281.30 BOB y 1 entrada de 8000.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
