---
id: TC-GOALS-SAVINGS-010
title: "Un aporte real hacia una cuenta no vinculada se rechaza sin crear la transferencia"
spec: goals/savings-goals
related_specs: []
requirement: "Aporte real mediante transferencia a una cuenta vinculada"
scenario: "Cuenta destino no vinculada"
requirement_status: provisional
fr: ["FR-GOALS-002"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "contribution"]
error_code: GOAL_ACCOUNT_NOT_LINKED
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1)"
input: {"fund": "REAL", "amount": {"amount": "500.00", "currency": "BOB"}, "sourceAccountId": "Banco BOB", "destinationAccountId": "Efectivo BOB"}
steps:
  - "POST …/contributions"
expected_result:
  - "422 GOAL_ACCOUNT_NOT_LINKED"
  - "No existe ninguna transferencia nueva ni movimiento"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-010 — Un aporte real hacia una cuenta no vinculada se rechaza sin crear la transferencia

## Intención

Los fondos reales de una meta solo pueden estar en sus cuentas vinculadas.

## Escenario

```gherkin
Cuando el EDITOR aporta 500.00 BOB hacia "Efectivo BOB"
Entonces se rechaza con GOAL_ACCOUNT_NOT_LINKED
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
