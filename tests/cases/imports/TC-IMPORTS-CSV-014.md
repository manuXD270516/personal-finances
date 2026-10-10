---
id: TC-IMPORTS-CSV-014
title: "Una fila con fecha en un periodo cerrado es inválida con PERIOD_CLOSED"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Validación de cada fila"
scenario: "Fila en un periodo cerrado"
requirement_status: confirmed
fr: ["FR-IMPORTS-006","FR-PLANNING-005"]
nfr: []
invariants: ["INV-015"]
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/application/imports.service.test.ts
  - packages/contexts/imports/src/domain/row-validator.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["csv-import"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "Periodo \"2026-08\" cerrado"
  - "Cuenta \"Banco BOB\" activa"
input: {"row":["15/08/2026","-75,00"]}
steps:
  - "Aplicar el mapeo a una fila del 2026-08-15"
expected_result:
  - "Fila inválida con PERIOD_CLOSED y decisión EXCLUDE fija"
  - "Al aprobar no se crea"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-014 — Una fila con fecha en un periodo cerrado es inválida con PERIOD_CLOSED

## Intención

INV-015: un periodo cerrado no cambia en silencio, tampoco por un import.

## Escenario

```gherkin
Dado el periodo 2026-08 cerrado
Cuando una fila es del 2026-08-15
Entonces es inválida con PERIOD_CLOSED y no se importará
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
