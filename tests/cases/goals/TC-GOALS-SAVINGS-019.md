---
id: TC-GOALS-SAVINGS-019
title: "Vincular una transferencia posteada a una cuenta vinculada la registra como aporte real por su monto"
spec: goals/savings-goals
related_specs: []
requirement: "Vincular una transacción existente como aporte real"
scenario: "Transferencia hecha desde la app del banco"
requirement_status: provisional
fr: ["FR-GOALS-010", "FR-TRANSACTIONS-003"]
nfr: []
invariants: ["INV-018"]
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "link"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1) con 1000.00 BOB"
  - "Transferencia POSTED de 500.00 BOB \"Banco BOB\" → \"Ahorro BOB\" del 2026-10-20 registrada a mano"
input: {"transactionId": "<transferencia de 500.00 BOB>"}
steps:
  - "POST …/contributions/link con Idempotency-Key"
  - "GET W/goals/transaction-links?transactionIds=<id>"
expected_result:
  - "201 con un movimiento REAL/CONTRIBUTION de 500.00 BOB que referencia la transferencia (revisión 1)"
  - "Progreso 1500.00 BOB"
  - "El enlace de la transacción indica \"Fondo de emergencia\""
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-019 — Vincular una transferencia posteada a una cuenta vinculada la registra como aporte real por su monto

## Intención

FR-GOALS-010: el owner transfiere desde la app del banco y luego lo cuenta como aporte, sin duplicar movimientos de dinero.

## Escenario

```gherkin
Dada una transferencia posteada de 500.00 BOB hacia "Ahorro BOB"
Cuando el EDITOR la vincula a "Fondo de emergencia"
Entonces la meta registra un aporte real de 500.00 BOB
  Y acumula 1500.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
