---
id: TC-TRANSACTIONS-RECONCILIATION-008
title: "El ajuste de reconciliación cuadra la diferencia con un asiento balanceado"
spec: transactions/reconciliation
related_specs: ["ledger/journal-posting", "transactions/transaction-recording"]
requirement: "Diferencia distinta de cero y ajuste de reconciliación"
scenario: "Finalizar con ajuste confirmado"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-030, FR-TRANSACTIONS-017]
nfr: []
invariants: [INV-004, INV-005, INV-023, INV-029]
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/reconciliation.api.test.ts
  - apps/web/src/ui/reconciliation/reconciliation.test.tsx
  - packages/contexts/transactions/src/application/reconciliations.service.test.ts
  - packages/contexts/transactions/src/domain/reconciliation-calculator.test.ts
  - packages/contexts/transactions/src/domain/reconciliation.test.ts
  - tests/e2e/specs/reconciliation.spec.ts
status: automated
regression_suite: true
phase: 2
tags: ["reconciliation", "adjustment", "money"]
error_code: null
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE) con saldo inicial 1000.00 BOB al 2026-02-28"
  - "Gasto G1 cleared de 150.00 BOB del 2026-03-05; ingreso I1 cleared de 2500.00 BOB del 2026-03-10"
  - "Gasto G2 posted de 45.90 BOB del 2026-03-20; gasto G3 cleared de 200.00 BOB del 2026-04-02"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "Sesión de \"Bank A\" al 2026-03-31 por 3345.00 BOB (diferencia −5.00 BOB)"
input:
  - "{\"adjustment\":{\"reason\":\"comisión bancaria no registrada\"}}"
  - "{\"adjustment\":{\"reason\":\"\"}}"
steps:
  - "POST complete con ajuste y motivo"
  - "En un estado limpio, POST complete con motivo vacío"
expected_result:
  - "Ajuste DECREASE 5.00 BOB en \"Bank A\", fecha 2026-03-31, reconciliation_id de la sesión"
  - "Asiento: ASSET:Bank A −5.00 BOB / EQUITY:ADJUSTMENTS:BOB +5.00 BOB (Σ = 0)"
  - "Ajuste, G1 e I1 reconciled; sesión COMPLETED con cleared_balance 3345.00"
  - "Saldo contable de \"Bank A\" 3099.10 BOB"
  - "Motivo vacío: 400 VALIDATION_FAILED y no se crea ninguna transacción"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-008 — El ajuste de reconciliación cuadra la diferencia con un asiento balanceado

## Intención

FR-TRANSACTIONS-030/017: la diferencia se cierra solo con un ajuste explícito, auditado y contablemente balanceado.

## Escenario

```gherkin
Dado una sesión de "Bank A" al 2026-03-31 con diferencia −5.00 BOB
Cuando el usuario la finaliza confirmando un ajuste con motivo "comisión bancaria no registrada"
Entonces se crea un ajuste de disminución de 5.00 BOB fechado 2026-03-31 contra el ajuste de patrimonio
  Y la sesión queda COMPLETED con saldo confirmado 3345.00 BOB
  Y el saldo contable de "Bank A" es 3099.10 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
