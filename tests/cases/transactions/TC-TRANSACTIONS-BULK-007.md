---
id: TC-TRANSACTIONS-BULK-007
title: "Cada transacción editada en lote se audita con el identificador de operación común"
spec: transactions/bulk-edit
related_specs: ["audit/audit-trail"]
requirement: "Auditoría de la edición masiva con identificador común"
scenario: "Auditoría de tres recategorizaciones"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-033, FR-AUDIT-001, FR-AUDIT-002]
nfr: []
invariants: [INV-029]
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/bulk-edit.api.test.ts
  - packages/contexts/audit/src/application/audit-recorder.test.ts
  - packages/contexts/audit/src/application/lifecycle.test.ts
  - packages/contexts/transactions/src/application/bulk-edit.service.test.ts
status: automated
regression_suite: false
phase: 2
tags: ["bulk-edit", "audit"]
error_code: null
preconditions:
  - "Workspace \"W1\"; cuenta \"Bank A\" (BOB) con saldo 2000.00 BOB"
  - "Gastos posted de un split en marzo de 2026, categoría \"Supermercado\": T1 45.90 BOB (v2), T2 150.00 BOB (v1), T3 200.00 BOB (v4)"
  - "Categoría de gasto activa \"Hogar\"; tag activo \"familia\""
input:
  - "{\"changes\":{\"categoryId\":\"Hogar\"}}"
  - "{\"inject\":\"falla al escribir el registro agregado\"}"
steps:
  - "Recategorizar T1–T3 en lote"
  - "Consultar auditoría por correlationId = bulkOperationId"
  - "Repetir en estado limpio con falla inyectada"
expected_result:
  - "3 registros transactions.transaction.updated con categoría antes \"Supermercado\" y después \"Hogar\", cada uno con changes.bulkOperationId"
  - "1 registro transactions.transaction.bulk_edited con count 3"
  - "Los 4 comparten correlation_id"
  - "Con falla: ninguna transacción cambia"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-BULK-007 — Cada transacción editada en lote se audita con el identificador de operación común

## Intención

FR-TRANSACTIONS-033 + INV-029: trazabilidad completa y atómica de la operación.

## Escenario

```gherkin
Dado tres gastos categorizados como "Supermercado"
Cuando el usuario los recategoriza en lote a "Hogar"
Entonces existen tres registros con el mismo identificador de operación masiva
  Y un registro agregado con 3 transacciones
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
