---
id: TC-TRANSACTIONS-RECONCILIATION-010
title: "El estado de reconciliación por cuenta informa último extracto y pendientes"
spec: transactions/reconciliation
related_specs: ["planning/month-closing"]
requirement: "Estado de reconciliación por cuenta"
scenario: "Estado de \"Bank A\" al cierre de marzo"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-030, FR-PLANNING-003]
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
status: automated
regression_suite: false
phase: 2
tags: ["reconciliation", "month-closing"]
error_code: null
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE) con saldo inicial 1000.00 BOB al 2026-02-28"
  - "Gasto G1 cleared de 150.00 BOB del 2026-03-05; ingreso I1 cleared de 2500.00 BOB del 2026-03-10"
  - "Gasto G2 posted de 45.90 BOB del 2026-03-20; gasto G3 cleared de 200.00 BOB del 2026-04-02"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "Sesión de \"Bank A\" al 2026-03-31 por 3350.00 BOB COMPLETED (G1, I1)"
  - "Cuenta \"Caja BOB\" nunca reconciliada con 2 gastos posted de marzo"
input:
  - "{\"account\":\"Bank A\",\"asOf\":\"2026-03-31\"}"
  - "{\"account\":\"Caja BOB\",\"asOf\":\"2026-03-31\"}"
steps:
  - "GET W/accounts/{id}/reconciliation-status?asOf=2026-03-31 para cada cuenta"
expected_result:
  - "\"Bank A\": lastCompleted 2026-03-31 / \"3350.00\", inProgress null, unreconciledCount 1 (G2)"
  - "\"Caja BOB\": lastCompleted null, unreconciledCount 2"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-010 — El estado de reconciliación por cuenta informa último extracto y pendientes

## Intención

Contrato que consume el checklist de cierre de mes (pf-p2a) para "cuentas sin reconciliar".

## Escenario

```gherkin
Dado "Bank A" reconciliada al 2026-03-31 con el gasto de 45.90 BOB aún posted
Cuando se consulta su estado con corte 2026-03-31
Entonces se informa reconciliada al 2026-03-31 con 3350.00 BOB
  Y 1 transacción sin reconciliar
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
