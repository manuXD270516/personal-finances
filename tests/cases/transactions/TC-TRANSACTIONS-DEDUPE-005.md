---
id: TC-TRANSACTIONS-DEDUPE-005
title: "Anular la transacción importada libera su identificador externo para un nuevo import"
spec: transactions/duplicate-detection
related_specs: ["imports/import-pipeline"]
requirement: "Una transacción viva por identificador externo"
scenario: "Referencia liberada al anular"
requirement_status: provisional
fr: ["FR-TRANSACTIONS-032", "FR-IMPORTS-010"]
nfr: []
invariants: ["INV-014"]
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/record-imported-transactions.test.ts
  - packages/contexts/transactions/test/integration/pg-imported.int.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "duplicate-detection"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
input: "Datos del scenario \"Referencia liberada al anular\" del delta de add-import-pipeline"
steps:
  - "la transacción importada con el identificador \"2026030100017\" se anula y el OFX se vuelve a importar"
expected_result:
  - "la fila es nueva y al aprobar se crea una transacción con esa referencia"
created: 2026-10-29
updated: 2026-10-29
---

# TC-TRANSACTIONS-DEDUPE-005 — Anular la transacción importada libera su identificador externo para un nuevo import

## Intención

Transactions DEBE (MUST) garantizar que en una cuenta exista a lo sumo una transacción no anulada por cada referencia externa importada (espacio de nombres de la institución y el formato, más el identificador), también cuando dos importaciones con la misma referencia se persisten a la vez; anular esa transacción DEBE (MUST) liberar la referencia para un import posterior.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando la transacción importada con el identificador "2026030100017" se anula y el OFX se vuelve a importar
Entonces la fila es nueva y al aprobar se crea una transacción con esa referencia
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
