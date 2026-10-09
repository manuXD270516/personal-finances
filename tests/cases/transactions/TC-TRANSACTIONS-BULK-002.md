---
id: TC-TRANSACTIONS-BULK-002
title: "La vista previa informa alcance y aplicabilidad sin modificar nada"
spec: transactions/bulk-edit
related_specs: ["transactions/transaction-recording"]
requirement: "Vista previa del alcance de la edición masiva"
scenario: "Vista previa por filtro"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-033, FR-TRANSACTIONS-012]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/bulk-edit.api.test.ts
  - apps/web/src/ui/transactions/bulk-edit.test.tsx
  - packages/contexts/transactions/src/application/bulk-edit.service.test.ts
  - tests/e2e/specs/bulk-edit.spec.ts
status: automated
regression_suite: false
phase: 2
tags: ["bulk-edit", "preview"]
error_code: null
preconditions:
  - "Workspace \"W1\"; cuenta \"Bank A\" (BOB) con saldo 2000.00 BOB"
  - "Gastos posted de un split en marzo de 2026, categoría \"Supermercado\": T1 45.90 BOB (v2), T2 150.00 BOB (v1), T3 200.00 BOB (v4)"
  - "Categoría de gasto activa \"Hogar\"; tag activo \"familia\""
  - "T4: gasto de marzo de 300.00 BOB con splits \"Supermercado\" 200.00 y 100.00 BOB"
input:
  filter: {"accountId":"Bank A","kind":"EXPENSE","categoryId":"Supermercado","from":"2026-03-01","to":"2026-03-31"}
  changes: {"categoryId":"Hogar"}
steps:
  - "POST W/transactions/bulk-edit/preview"
  - "Contar registros de auditoría y versiones antes y después"
expected_result:
  - "count 4; T1–T3 aplicables con su versión; T4 no aplicable con BULK_EDIT_NOT_APPLICABLE"
  - "Ninguna versión cambia y no hay auditoría nueva"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-BULK-002 — La vista previa informa alcance y aplicabilidad sin modificar nada

## Intención

La vista previa es la red de seguridad de un cambio masivo: debe ser fiel y sin efectos.

## Escenario

```gherkin
Dado 3 gastos de un split y 1 con dos splits en "Supermercado"
Cuando el usuario pide la vista previa de "categoría Hogar"
Entonces informa 4 transacciones, 3 aplicables y 1 no aplicable
  Y nada cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
