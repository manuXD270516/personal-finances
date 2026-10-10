---
id: TC-GOALS-SAVINGS-011
title: "Un aporte real con fecha en un periodo cerrado se rechaza con PERIOD_CLOSED y no deja aporte huérfano"
spec: goals/savings-goals
related_specs: []
requirement: "Aporte real mediante transferencia a una cuenta vinculada"
scenario: "Fecha en un periodo cerrado"
requirement_status: provisional
fr: ["FR-GOALS-002", "FR-LEDGER-011"]
nfr: []
invariants: ["INV-015", "INV-018"]
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "contribution", "period"]
error_code: PERIOD_CLOSED
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1)"
  - "Periodo \"2026-09\" cerrado"
input: {"fund": "REAL", "amount": {"amount": "500.00", "currency": "BOB"}, "businessDate": "2026-09-20"}
steps:
  - "POST …/contributions con fecha 2026-09-20"
expected_result:
  - "409 PERIOD_CLOSED propagado desde Transactions"
  - "Ni la transferencia ni el movimiento ni la auditoría persisten"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-011 — Un aporte real con fecha en un periodo cerrado se rechaza con PERIOD_CLOSED y no deja aporte huérfano

## Intención

El error del ledger revierte la unidad de trabajo completa: no hay aportes sin transferencia.

## Escenario

```gherkin
Dado el periodo "2026-09" cerrado
Cuando el EDITOR aporta 500.00 BOB con fecha 2026-09-20
Entonces se rechaza con PERIOD_CLOSED
  Y no se crea nada
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
