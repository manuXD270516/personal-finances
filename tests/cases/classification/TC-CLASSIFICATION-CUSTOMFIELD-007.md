---
id: TC-CLASSIFICATION-CUSTOMFIELD-007
title: "Asignar custom fields no toca el ledger y queda auditado"
spec: classification/custom-fields
related_specs: ["ledger/journal-posting", "audit/audit-trail"]
requirement: "Asignar custom fields no modifica el ledger"
scenario: "Cambiar el centro de costo de un gasto posteado"
requirement_status: confirmed
fr: [FR-CLASSIFICATION-009, FR-TRANSACTIONS-008, FR-AUDIT-001]
nfr: []
invariants: [INV-033, INV-029]
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/custom-fields.service.test.ts
  - packages/contexts/accounts/src/application/custom-fields.service.test.ts
  - apps/api/test/api/custom-fields.api.test.ts
  - packages/contexts/audit/src/domain/redaction-policy.test.ts
  - apps/web/src/ui/custom-fields/custom-fields.test.tsx
status: automated
regression_suite: true
phase: 2
tags: ["custom-fields", "ledger", "audit"]
error_code: null
preconditions:
  - "Custom field de transacción \"centro_costo\" (SELECT, opciones \"casa\" y \"oficina\", no obligatorio)"
  - "\"Bank A\" con saldo 2000.00 BOB"
  - "Gasto posted de 150.00 BOB con centro_costo = \"casa\""
input:
  customFields: [{"field":"centro_costo","value":"oficina"}]
steps:
  - "Contar asientos"
  - "Cambiar el valor"
  - "Consultar saldo, asientos y auditoría"
expected_result:
  - "Mismo número de asientos; \"Bank A\" 2000.00 BOB"
  - "Auditoría con customFields.centro_costo antes \"casa\" y después \"oficina\""
  - "TransactionUpdated.v1 con changedFields [customFields]"
created: 2026-10-05
updated: 2026-10-08
---

# TC-CLASSIFICATION-CUSTOMFIELD-007 — Asignar custom fields no toca el ledger y queda auditado

## Intención

INV-033 extendido a custom fields: metadatos sin impacto contable.

## Escenario

```gherkin
Dado un gasto posteado de 150.00 BOB con "centro_costo" = "casa"
Cuando el usuario lo cambia a "oficina"
Entonces el número de asientos no cambia y el saldo sigue en 2000.00 BOB
  Y la auditoría registra "casa" antes y "oficina" después
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
