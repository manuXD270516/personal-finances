---
id: TC-IMPORTS-CSV-022
title: "Aprobar con un posible duplicado sin decidir se rechaza con IMPORT_REVIEW_INCOMPLETE"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Aprobación y creación de las transacciones"
scenario: "Decisión pendiente"
requirement_status: confirmed
fr: ["FR-IMPORTS-003"]
nfr: ["NFR-DATA-016"]
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/application/imports.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["csv-import"]
error_code: IMPORT_REVIEW_INCOMPLETE
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"pendingDecisions":1}
steps:
  - "POST W/imports/{id}/approve con 1 posible duplicado sin decisión"
expected_result:
  - "409 IMPORT_REVIEW_INCOMPLETE con pendingDecisions = 1"
  - "Ninguna transacción creada; status AWAITING_REVIEW"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-022 — Aprobar con un posible duplicado sin decidir se rechaza con IMPORT_REVIEW_INCOMPLETE

## Intención

Ningún posible duplicado se resuelve por omisión: el usuario decide.

## Escenario

```gherkin
Dada una vista previa con 1 posible duplicado sin decidir
Cuando apruebo
Entonces se rechaza con IMPORT_REVIEW_INCOMPLETE
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
