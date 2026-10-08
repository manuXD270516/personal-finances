---
id: TC-PLANNING-CHECKLIST-001
title: El checklist de cierre informa pendientes, cuentas sin conciliar, duplicados y porciones sin categoría del periodo
spec: planning/month-closing
related_specs: []
requirement: Checklist previo al cierre
scenario: Checklist de octubre con observaciones
requirement_status: confirmed
fr:
  - FR-PLANNING-003
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/month-closing.api.test.ts
  - apps/web/src/ui/planning/closing.test.tsx
  - packages/contexts/planning/src/domain/close-checklist.test.ts
  - packages/contexts/transactions/test/integration/pg-closing.int.test.ts
status: automated
regression_suite: true
phase: 2
tags:
  - month-closing
  - checklist
error_code: null
preconditions:
  - '"2026-10" (2026-10-01..2026-10-31) active y terminado'
  - Gastos pending de 120.00 BOB (2026-10-28) y 45.00 BOB (2026-10-30); gasto pending de 60.00 BOB (2026-11-01)
  - Un candidato a duplicado OPEN con una transacción de octubre
  - Tres porciones posteadas de octubre con categoría UNCATEGORIZED por 210.00 BOB en total
  - '"USD Savings" con su última conciliación al 2026-09-30'
input:
  period: 2026-10
steps:
  - GET /periods/{id}/close-checklist
  - Consultar el periodo y la auditoría
expected_result:
  - "PENDING_TRANSACTIONS: 2, 165.00 BOB (el gasto del 2026-11-01 no cuenta)"
  - 'UNRECONCILED_ACCOUNTS: 1 ("USD Savings")'
  - "UNRESOLVED_DUPLICATES: 1"
  - "UNCATEGORIZED: 3, 210.00 BOB"
  - "UNRESOLVED_RECURRING: NOT_AVAILABLE"
  - El periodo no cambia y no se escribe auditoría
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-CHECKLIST-001 — El checklist de cierre informa pendientes, cuentas sin conciliar, duplicados y porciones sin categoría del periodo

## Intención

FR-PLANNING-003: el owner necesita ver qué falta antes de congelar el mes.

## Escenario

```gherkin
Dado que "2026-10" tiene 2 pendientes por 165.00 BOB y 3 porciones sin categoría por 210.00 BOB
Cuando se consulta el checklist de cierre
Entonces informa 2 pendientes por 165.00 BOB y 3 porciones sin categoría por 210.00 BOB
  Y el periodo no cambia
```

## Notas

- Cubre también "Checklist sin observaciones". El ítem de cuentas depende de pf-p2c (ReconciliationStatusQuery).
