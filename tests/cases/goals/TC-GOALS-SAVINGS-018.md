---
id: TC-GOALS-SAVINGS-018
title: "Un gasto pendiente no dispara la sobre-asignación porque no cambia el saldo contable"
spec: goals/savings-goals
related_specs: []
requirement: "Meta sobre-asignada cuando el saldo cae"
scenario: "Gasto pendiente"
requirement_status: provisional
fr: ["FR-GOALS-004", "FR-LEDGER-012"]
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "over-allocation", "pending"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "\"Banco BOB\" saldo 7000.00 BOB, reservado 7000.00 BOB"
input: {"pending_expense": "500.00 BOB"}
steps:
  - "Registrar un gasto PENDING de 500.00 BOB en \"Banco BOB\""
  - "Correr el job goals.daily-evaluation"
expected_result:
  - "\"Banco BOB\" sigue NORMAL; sin hecho de sobre-asignación"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-018 — Un gasto pendiente no dispara la sobre-asignación porque no cambia el saldo contable

## Intención

La base del límite es el saldo contable (pregunta 5); las pendientes las descuenta Q5.

## Escenario

```gherkin
Dado "Banco BOB" con 7000.00 BOB todos reservados
Cuando se registra un gasto pendiente de 500.00 BOB
Entonces la cuenta no se marca sobre-asignada
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
