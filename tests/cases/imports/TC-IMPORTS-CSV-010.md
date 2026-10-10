---
id: TC-IMPORTS-CSV-010
title: "Con coma decimal el valor 8.000,00 se interpreta como 8000.00 BOB exactos"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Formato de fecha y separador decimal explícitos"
scenario: "Coma decimal con punto de miles"
requirement_status: provisional
fr: ["FR-IMPORTS-003","FR-IMPORTS-006"]
nfr: []
invariants: ["INV-001","INV-003"]
priority: critical
type: property
level: property
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
input: {"decimalSeparator":",","value":"8.000,00"}
steps:
  - "Normalizar \"8.000,00\" con coma decimal"
  - "PBT: para todo monto y escala, parse(format(m, locale)) == m"
expected_result:
  - "8000.00 BOB como Decimal (nunca number)"
  - "La propiedad se cumple para coma y punto decimal"
created: 2026-10-09
updated: 2026-10-09
---

# TC-IMPORTS-CSV-010 — Con coma decimal el valor 8.000,00 se interpreta como 8000.00 BOB exactos

## Intención

INV-001: el parser produce string → Decimal; el formato numérico del extracto boliviano (coma decimal) es explícito.

## Escenario

```gherkin
Dado el separador decimal coma
Cuando normalizo 8.000,00
Entonces el monto es 8000.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
