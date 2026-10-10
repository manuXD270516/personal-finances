---
id: TC-GOALS-SAVINGS-022
title: "Anular la transferencia de un aporte registra un movimiento inverso y conserva el original"
spec: goals/savings-goals
related_specs: []
requirement: "Anulación o revisión de la transacción de un movimiento"
scenario: "Transferencia anulada"
requirement_status: provisional
fr: ["FR-GOALS-002", "FR-GOALS-005"]
nfr: []
invariants: ["INV-018", "INV-028"]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "void", "events"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1) con 1500.00 BOB, 500.00 BOB por la transferencia vinculada del 2026-10-20"
  - "Worker con goals.transaction-changes"
input: {}
steps:
  - "Anular la transferencia desde Transactions"
  - "Entregar transactions.TransactionVoided.v1 dos veces"
  - "GET …/movements"
expected_result:
  - "Un único movimiento REVERSAL de −500.00 BOB con reverses_id del aporte (único por reverses_id)"
  - "Progreso 1000.00 BOB"
  - "El aporte original sigue en el historial; auditoría con actor de proceso"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-022 — Anular la transferencia de un aporte registra un movimiento inverso y conserva el original

## Intención

INV-018 se mantiene cuando la transacción respaldatoria desaparece del ledger.

## Escenario

```gherkin
Dado un aporte de 500.00 BOB respaldado por una transferencia
Cuando esa transferencia se anula
Entonces la meta registra un inverso de −500.00 BOB
  Y acumula 1000.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
