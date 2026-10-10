---
id: TC-IMPORTS-CSV-011
title: "Un monto con más decimales que la escala de la moneda es inválido y nunca se redondea"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Formato de fecha y separador decimal explícitos"
scenario: "Exceso de escala nunca se redondea"
requirement_status: provisional
fr: ["FR-IMPORTS-003","FR-IMPORTS-006"]
nfr: []
invariants: ["INV-001","INV-003"]
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
input: {"decimalSeparator":".","value":"1.234","currency":"BOB"}
steps:
  - "Normalizar \"1.234\" con punto decimal para una cuenta en BOB"
expected_result:
  - "Fila inválida con IMPORT_INVALID_AMOUNT (3 decimales, escala 2)"
  - "No se produce 1.23 BOB"
created: 2026-10-09
updated: 2026-10-09
---

# TC-IMPORTS-CSV-011 — Un monto con más decimales que la escala de la moneda es inválido y nunca se redondea

## Intención

INV-003: el ingreso con más escala se rechaza; redondear en silencio cambiaría montos reales.

## Escenario

```gherkin
Dado el separador decimal punto y una cuenta en BOB
Cuando una fila trae 1.234
Entonces la fila es inválida y no se convierte en 1.23 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
