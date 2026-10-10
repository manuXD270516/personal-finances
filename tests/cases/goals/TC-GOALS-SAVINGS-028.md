---
id: TC-GOALS-SAVINGS-028
title: "Reasignar fondos reales a una meta que no tiene la cuenta vinculada se rechaza y ninguna meta cambia"
spec: goals/savings-goals
related_specs: []
requirement: "Reasignación de fondos entre metas"
scenario: "Fondos reales hacia una meta sin la cuenta vinculada"
requirement_status: provisional
fr: ["FR-GOALS-005"]
nfr: []
invariants: ["INV-018"]
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "reassign", "validation"]
error_code: GOAL_ACCOUNT_NOT_LINKED
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1) con 1000.00 BOB reales en \"Ahorro BOB\""
  - "Meta \"Laptop\" (purchase, 9000.00 BOB, sin fecha objetivo, sin cuentas vinculadas)"
input: {"targetGoalId": "Laptop", "fund": "REAL", "accountId": "Ahorro BOB", "amount": "300.00 BOB"}
steps:
  - "POST W/goals/{Fondo de emergencia}/reassignments"
expected_result:
  - "422 GOAL_ACCOUNT_NOT_LINKED"
  - "Ningún movimiento en ninguna meta"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-028 — Reasignar fondos reales a una meta que no tiene la cuenta vinculada se rechaza y ninguna meta cambia

## Intención

Los fondos reales de una meta deben estar en una cuenta vinculada a ella.

## Escenario

```gherkin
Cuando el EDITOR reasigna 300.00 BOB reales de "Ahorro BOB" a "Laptop"
Entonces se rechaza con GOAL_ACCOUNT_NOT_LINKED
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
