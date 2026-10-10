---
id: TC-GOALS-SAVINGS-024
title: "Retirar fondos reales crea una transferencia desde la cuenta vinculada y un retiro negativo con motivo"
spec: goals/savings-goals
related_specs: []
requirement: "Retiro de fondos de una meta"
scenario: "Retiro con transferencia nueva"
requirement_status: provisional
fr: ["FR-GOALS-005"]
nfr: []
invariants: ["INV-018", "INV-029"]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "withdrawal"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1) con 1000.00 BOB de aportes reales en \"Ahorro BOB\""
input: {"fund": "REAL", "accountId": "Ahorro BOB", "amount": "400.00 BOB", "mode": {"type": "TRANSFER", "toAccountId": "Banco BOB"}, "reason": "Gasto médico"}
steps:
  - "POST …/withdrawals con Idempotency-Key"
expected_result:
  - "Transferencia POSTED de 400.00 BOB \"Ahorro BOB\" → \"Banco BOB\" con source GOAL"
  - "Movimiento REAL/WITHDRAWAL de −400.00 BOB con el motivo y la transacción"
  - "Progreso 600.00 BOB; auditoría con actor EDITOR"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-024 — Retirar fondos reales crea una transferencia desde la cuenta vinculada y un retiro negativo con motivo

## Intención

FR-GOALS-005: retirar es explícito, auditado y deja rastro en el ledger.

## Escenario

```gherkin
Dado "Fondo de emergencia" con 1000.00 BOB en "Ahorro BOB"
Cuando el EDITOR retira 400.00 BOB hacia "Banco BOB"
Entonces existe una transferencia de 400.00 BOB con origen meta
  Y la meta acumula 600.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
