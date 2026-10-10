---
id: TC-IMPORTS-CSV-013
title: "Una fila de monto cero o con fecha más de 3 días en el futuro es inválida"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Validación de cada fila"
scenario: "Monto cero y fecha futura"
requirement_status: confirmed
fr: ["FR-IMPORTS-006"]
nfr: ["NFR-DATA-016"]
invariants: []
priority: high
type: domain
level: import
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
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"rows":[["10/10/2026","0,00"],["25/10/2026","-50,00"],["22/10/2026","-30,00"]]}
steps:
  - "Aplicar el mapeo a las 3 filas el 2026-10-20"
expected_result:
  - "Fila 1: IMPORT_INVALID_AMOUNT"
  - "Fila 2: IMPORT_FUTURE_DATE"
  - "Fila 3: válida (dentro de hoy + 3 días)"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-013 — Una fila de monto cero o con fecha más de 3 días en el futuro es inválida

## Intención

Validaciones de negocio de docs/13 §4.1 etapa Validate; ninguna fila inválida se importa.

## Escenario

```gherkin
Dadas filas de 0,00, una del 2026-10-25 y otra del 2026-10-22
Cuando valido el 2026-10-20
Entonces la de monto cero y la del 25 son inválidas
  Y la del 22 es válida
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
