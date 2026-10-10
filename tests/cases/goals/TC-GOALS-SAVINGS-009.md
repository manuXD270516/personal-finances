---
id: TC-GOALS-SAVINGS-009
title: "Un aporte real crea una transferencia posteada con origen meta y el movimiento en la misma transacción"
spec: goals/savings-goals
related_specs: ["transactions/transfers"]
requirement: "Aporte real mediante transferencia a una cuenta vinculada"
scenario: "Aporte de 1000.00 BOB"
requirement_status: provisional
fr: ["FR-GOALS-002", "FR-TRANSACTIONS-003"]
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
tags: ["goals", "contribution", "ledger"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1)"
  - "\"Banco BOB\" con saldo 8000.00 BOB y \"Ahorro BOB\" con 0.00 BOB"
  - "FixedClock en 2026-10-15T10:00:00-04:00"
input: {"fund": "REAL", "amount": {"amount": "1000.00", "currency": "BOB"}, "sourceAccountId": "Banco BOB", "destinationAccountId": "Ahorro BOB"}
steps:
  - "POST W/goals/{id}/contributions con Idempotency-Key"
  - "Consultar la transacción creada, los saldos y la meta"
expected_result:
  - "Transferencia POSTED de 1000.00 BOB \"Banco BOB\" → \"Ahorro BOB\" con source GOAL y externalRef goals.movement"
  - "Movimiento REAL/CONTRIBUTION de 1000.00 BOB con transaction_id y revisión 1"
  - "Saldos: \"Banco BOB\" 7000.00 BOB, \"Ahorro BOB\" 1000.00 BOB; progreso 1000.00 BOB (6.67 %)"
  - "Outbox con TransferCompleted.v1 y SavingsContributionRecorded.v1 en la misma transacción; un fallo inyectado tras el posteo revierte todo"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-009 — Un aporte real crea una transferencia posteada con origen meta y el movimiento en la misma transacción

## Intención

INV-018: cada aporte real referencia una transferencia posteada del mismo monto a una cuenta vinculada; nunca queda una sin la otra.

## Escenario

```gherkin
Dado "Banco BOB" con 8000.00 BOB
Cuando el EDITOR aporta 1000.00 BOB a "Fondo de emergencia" hacia "Ahorro BOB"
Entonces existe una transferencia posteada de 1000.00 BOB con origen meta
  Y la meta acumula 1000.00 BOB (6.67 %)
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
