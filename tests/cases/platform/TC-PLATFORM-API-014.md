---
id: TC-PLATFORM-API-014
title: Editar sobre una versión obsoleta se rechaza con 412 y no pierde la otra edición
spec: platform/api-conventions
related_specs:
- transactions/transaction-recording
requirement: Rechazo de modificaciones sobre una versión obsoleta
scenario: Dos pestañas editan el mismo gasto
requirement_status: confirmed
fr:
- FR-TRANSACTIONS-011
nfr:
- NFR-DATA-014
invariants: []
priority: critical
type: api
level: api
automation_status: automated
automated_tests:
- apps/api/test/api/api-conventions.api.test.ts
- packages/platform/src/api/errors/error-catalog.test.ts
- apps/web/src/bff/finance-api-client.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- etag
- concurrency
- money
error_code: PRECONDITION_FAILED
preconditions:
- Gasto T1 de 75.00 BOB en versión 4 en W1; EDITOR autenticado
input:
- If-Match: '"4"'
  amount:
    amount: '80.00'
    currency: BOB
- If-Match: '"4"'
  amount:
    amount: '90.00'
    currency: BOB
- caso: carrera entre chequeo y UPDATE simulada
  If-Match: '"5"'
steps:
- PATCH T1 a 80.00 BOB con If-Match "4"
- PATCH T1 a 90.00 BOB con If-Match "4"
- Simular una escritura concurrente entre la verificación y el UPDATE
expected_result:
- 'Primer PATCH: 200 con ETag "5"'
- 'Segundo PATCH: 412 PRECONDITION_FAILED con currentVersion 5; el gasto queda en 80.00 BOB'
- 'Carrera: 409 CONCURRENCY_CONFLICT sin cambios'
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-014 — Editar sobre una versión obsoleta se rechaza con 412 y no pierde la otra edición

## Intención

Dos pestañas editando la misma transacción no deben pisarse en silencio (ADR-0022).

## Escenario

```gherkin
Dado un gasto de 75.00 BOB en versión 4
Cuando una pestaña lo cambia a 80.00 BOB
  Y otra envía 90.00 BOB con "If-Match" "4"
Entonces la segunda recibe 412 con código "PRECONDITION_FAILED"
  Y el gasto queda en 80.00 BOB
```

## Notas

- Requiere add-transaction-recording para el PATCH de transacciones; antes se ejecuta sobre PATCH /workspaces/{W1}.
