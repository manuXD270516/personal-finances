---
id: TC-TRANSACTIONS-RECONCILIATION-018
title: "La marca RECONCILED_WITHOUT_STATEMENT filtra el listado y no se edita a mano"
spec: transactions/reconciliation
related_specs: ["transactions/transaction-recording", "transactions/bulk-edit"]
requirement: "Marca de seguimiento de las conciliadas sin extracto"
scenario: "Listar las conciliadas sin extracto pendientes de revisión"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-030, FR-TRANSACTIONS-012]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/reconciliation.api.test.ts
  - apps/web/src/ui/reconciliation/reconciliation.test.tsx
  - packages/contexts/transactions/src/application/reconciliations.service.test.ts
  - tests/e2e/specs/reconciliation.spec.ts
status: automated
regression_suite: false
phase: 2
tags: ["without-statement", "filter", "system-flag"]
error_code: "VALIDATION_FAILED"
preconditions:
  - "Cuenta \"Caja BOB\" (ASSET, BOB, ACTIVE, sin sesiones) con saldo inicial 500.00 BOB"
  - "Gasto C1 de 80.00 BOB del 2026-03-12 en \"Caja BOB\""
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "C1 conciliado sin extracto"
  - "G1 reconciled en la sesión de \"Bank A\" al 2026-03-31 (modo STATEMENT)"
  - "I1 cleared en \"Bank A\""
input:
  query: "systemFlag=RECONCILED_WITHOUT_STATEMENT"
  patchTag: {"tags": ["+viaje"]}
  patchFlags: {"systemFlags": []}
steps:
  - "GET W/transactions?systemFlag=RECONCILED_WITHOUT_STATEMENT"
  - "GET W/transactions?systemFlag=RECONCILED_WITHOUT_STATEMENT&accountId=<Bank A>"
  - "PATCH C1 con systemFlags: []"
  - "Edición masiva sobre C1 que intenta quitar la marca"
expected_result:
  - "Primer listado: solo C1, con systemFlags [RECONCILED_WITHOUT_STATEMENT]"
  - "Filtrado por \"Bank A\": vacío"
  - "PATCH con systemFlags: 422 VALIDATION_FAILED; C1 conserva la marca y el modo"
  - "Edición masiva con systemFlags: 422 VALIDATION_FAILED; ningún ítem cambia"
created: 2026-10-08
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-018 — La marca RECONCILED_WITHOUT_STATEMENT filtra el listado y no se edita a mano

## Intención

Decisión docs/33 D111: la marca dedicada, derivada y no editable permite el seguimiento posterior; se eligió en lugar de un tag reservado (los tags son editables y alimentan presupuestos por tag).

## Escenario

```gherkin
Dado un gasto conciliado sin extracto en "Caja BOB" y otro reconciliado en sesión en "Bank A"
Cuando el usuario filtra por la marca "conciliada sin extracto"
Entonces obtiene solo el de "Caja BOB"
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
