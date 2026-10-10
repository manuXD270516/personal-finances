---
id: TC-GOALS-SAVINGS-020
title: "Vincular un gasto, una transferencia pendiente o una hacia una cuenta no vinculada se rechaza con sus motivos"
spec: goals/savings-goals
related_specs: []
requirement: "Vincular una transacción existente como aporte real"
scenario: "Gasto no elegible"
requirement_status: provisional
fr: ["FR-GOALS-010"]
nfr: []
invariants: ["INV-018"]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "link", "validation"]
error_code: GOAL_TRANSACTION_NOT_ELIGIBLE
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1)"
  - "Gasto POSTED de 300.00 BOB; transferencia PENDING de 500.00 BOB hacia \"Ahorro BOB\"; transferencia POSTED de 200.00 BOB hacia \"Efectivo BOB\""
input: {}
steps:
  - "Vincular el gasto"
  - "Vincular la transferencia pendiente"
  - "Vincular la transferencia hacia \"Efectivo BOB\""
expected_result:
  - "422 GOAL_TRANSACTION_NOT_ELIGIBLE con reasons [KIND]"
  - "422 con reasons [STATUS]"
  - "422 con reasons [ACCOUNT]"
  - "Ningún movimiento"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-020 — Vincular un gasto, una transferencia pendiente o una hacia una cuenta no vinculada se rechaza con sus motivos

## Intención

Solo transferencias posteadas hacia una cuenta vinculada son aportes reales (INV-018; pregunta 3).

## Escenario

```gherkin
Cuando el EDITOR vincula un gasto de 300.00 BOB
Entonces se rechaza con GOAL_TRANSACTION_NOT_ELIGIBLE con el motivo KIND
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
