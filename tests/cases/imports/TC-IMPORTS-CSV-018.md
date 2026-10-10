---
id: TC-IMPORTS-CSV-018
title: "Dos compras idénticas del mismo día crean dos gastos y una anulada vuelve a ser importable"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Idempotencia por fila"
scenario: "Dos cafés idénticos el mismo día"
requirement_status: confirmed
fr: ["FR-IMPORTS-010"]
nfr: []
invariants: ["INV-014"]
priority: critical
type: domain
level: import
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/application/imports.service.test.ts
  - packages/contexts/imports/src/domain/duplicate-classifier.test.ts
  - packages/contexts/imports/src/domain/row-fingerprint.test.ts
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
input: {"rows":[["02/10/2026","PAGO QR CAFÉ","-18,00"],["02/10/2026","PAGO QR CAFÉ","-18,00"]]}
steps:
  - "Importar extracto-octubre.csv"
  - "Anular uno de los cafés importados"
  - "Subir de nuevo el mismo archivo"
expected_result:
  - "Primera importación: 2 gastos de 18.00 BOB (occurrenceIndex 0 y 1)"
  - "Re-subida: el café anulado es nuevo; las otras 3 filas ya importadas"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-018 — Dos compras idénticas del mismo día crean dos gastos y una anulada vuelve a ser importable

## Intención

docs/13 §7.2: el ordinal entre filas idénticas distingue compras legítimamente repetidas; un vínculo con una transacción anulada deja de bloquear.

## Escenario

```gherkin
Dadas dos filas idénticas de 18,00 del 2026-10-02
Cuando importo el archivo
Entonces se crean dos gastos de 18.00 BOB
Cuando anulo uno y reimporto
Entonces esa fila es nueva y las demás ya importadas
```

## Notas

- Cubre también el scenario "Transacción importada anulada".
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
