---
id: TC-GOALS-SAVINGS-025
title: "Un retiro mayor que los fondos de la meta en esa cuenta se rechaza con GOAL_INSUFFICIENT_FUNDS"
spec: goals/savings-goals
related_specs: []
requirement: "Retiro de fondos de una meta"
scenario: "Retiro mayor que los fondos"
requirement_status: provisional
fr: ["FR-GOALS-005"]
nfr: []
invariants: ["INV-018"]
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "withdrawal", "guard"]
error_code: GOAL_INSUFFICIENT_FUNDS
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1) con 1000.00 BOB reales en \"Ahorro BOB\""
  - "\"Ahorro BOB\" con saldo 1500.00 BOB (500.00 BOB no son de la meta)"
input: {"fund": "REAL", "accountId": "Ahorro BOB", "amount": "1200.00 BOB", "mode": {"type": "TRANSFER", "toAccountId": "Banco BOB"}}
steps:
  - "POST …/withdrawals"
expected_result:
  - "422 GOAL_INSUFFICIENT_FUNDS aunque el saldo de la cuenta alcance"
  - "Sin transferencia ni movimiento"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-025 — Un retiro mayor que los fondos de la meta en esa cuenta se rechaza con GOAL_INSUFFICIENT_FUNDS

## Intención

Ningún (meta, cuenta, fondo) queda negativo (PBT de design.md decisión 2).

## Escenario

```gherkin
Dado "Fondo de emergencia" con 1000.00 BOB en "Ahorro BOB"
Cuando el EDITOR retira 1200.00 BOB
Entonces se rechaza con GOAL_INSUFFICIENT_FUNDS
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
