---
id: TC-GOALS-SAVINGS-026
title: "Un gasto existente puede vincularse como retiro parcial y una reserva puede liberarse sin transacción"
spec: goals/savings-goals
related_specs: []
requirement: "Retiro de fondos de una meta"
scenario: "Retiro vinculado a un gasto"
requirement_status: provisional
fr: ["FR-GOALS-005"]
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
tags: ["goals", "withdrawal", "earmark"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1) con 1000.00 BOB reales en \"Ahorro BOB\""
  - "Gasto POSTED \"Reparación auto\" de 300.00 BOB desde \"Ahorro BOB\""
  - "Meta \"Laptop\" (purchase, 9000.00 BOB, sin fecha objetivo, sin cuentas vinculadas) con 2000.00 BOB reservados en \"Banco BOB\""
input: {"link": {"transactionId": "<Reparación auto>", "amount": "300.00 BOB"}, "release": {"goal": "Laptop", "amount": "500.00 BOB"}}
steps:
  - "POST …/withdrawals con mode LINK"
  - "POST …/withdrawals de \"Laptop\" con mode RELEASE"
  - "GET W/goals/reservations?accountId=Banco BOB"
expected_result:
  - "Retiro de −300.00 BOB que referencia el gasto, sin transacción nueva; progreso 700.00 BOB"
  - "Liberación EARMARK/WITHDRAWAL de −500.00 BOB; \"Laptop\" acumula 1500.00 BOB"
  - "Disponible para reservar de \"Banco BOB\" sube 500.00 BOB"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-026 — Un gasto existente puede vincularse como retiro parcial y una reserva puede liberarse sin transacción

## Intención

Usar el dinero de una meta (pagar la reparación) o soltar una reserva queda registrado sin mover dinero dos veces.

## Escenario

```gherkin
Dado el gasto "Reparación auto" de 300.00 BOB desde "Ahorro BOB"
Cuando el EDITOR lo vincula como retiro de "Fondo de emergencia"
Entonces la meta registra −300.00 BOB sin crear otra transacción
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
- Pregunta abierta 11: el monto del retiro puede ser menor o igual al de la transacción.
