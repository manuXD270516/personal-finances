---
id: TC-GOALS-SAVINGS-012
title: "Una reserva registra el movimiento sin transacción ni asiento y no cambia el saldo contable"
spec: goals/savings-goals
related_specs: []
requirement: "Reserva sobre el saldo de una cuenta"
scenario: "Reserva para la laptop"
requirement_status: provisional
fr: ["FR-GOALS-002"]
nfr: []
invariants: ["INV-018"]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "earmark"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Laptop\" (purchase, 9000.00 BOB, sin fecha objetivo, sin cuentas vinculadas)"
  - "\"Banco BOB\" con saldo contable 7000.00 BOB y sin reservas"
input: {"fund": "EARMARK", "amount": {"amount": "2000.00", "currency": "BOB"}, "sourceAccountId": "Banco BOB"}
steps:
  - "POST …/contributions"
  - "Contar transacciones y asientos antes y después"
  - "GET la meta"
expected_result:
  - "Movimiento EARMARK/CONTRIBUTION de 2000.00 BOB sobre \"Banco BOB\" sin transaction_id"
  - "Cero transacciones y cero asientos nuevos; saldo de \"Banco BOB\" sigue 7000.00 BOB"
  - "Progreso de \"Laptop\" 2000.00 BOB (22.22 %)"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-012 — Una reserva registra el movimiento sin transacción ni asiento y no cambia el saldo contable

## Intención

Una reserva es una asignación virtual: nunca toca el ledger (docs/09 §6).

## Escenario

```gherkin
Cuando el EDITOR reserva 2000.00 BOB de "Banco BOB" para "Laptop"
Entonces la meta acumula 2000.00 BOB (22.22 %)
  Y el saldo contable de "Banco BOB" sigue en 7000.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
