---
id: TC-IMPORTS-CSV-008
title: "Con la convención positivo es salida un cargo de tarjeta de 120,00 es una salida de 120.00 BOB"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Mapeo manual de columnas"
scenario: "Cargos positivos de una tarjeta"
requirement_status: confirmed
fr: ["FR-IMPORTS-003"]
nfr: []
invariants: []
priority: medium
type: domain
level: import
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/domain/row-normalizer.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["csv-import"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB"
  - "Cuenta \"Visa\" (LIABILITY, BOB, activa)"
input: {"mapping":{"amount":{"mode":"SIGNED","signConvention":"POSITIVE_IS_OUTFLOW"}},"value":"120,00"}
steps:
  - "Subir el extracto de \"Visa\" con el cargo \"120,00\""
  - "Aplicar el mapeo con POSITIVE_IS_OUTFLOW"
expected_result:
  - "La fila es una salida (gasto) de 120.00 BOB"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-008 — Con la convención positivo es salida un cargo de tarjeta de 120,00 es una salida de 120.00 BOB

## Intención

Los extractos de tarjeta suelen traer los cargos en positivo; la convención es explícita, no inferida.

## Escenario

```gherkin
Dado el extracto de Visa con el cargo 120,00
Cuando elijo positivo es salida
Entonces la fila es una salida de 120.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
