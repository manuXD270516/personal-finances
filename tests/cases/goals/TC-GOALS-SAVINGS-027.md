---
id: TC-GOALS-SAVINGS-027
title: "Reasignar una reserva entre metas registra dos movimientos ligados y no cambia lo reservado de la cuenta"
spec: goals/savings-goals
related_specs: []
requirement: "Reasignación de fondos entre metas"
scenario: "Reasignar una reserva"
requirement_status: provisional
fr: ["FR-GOALS-005"]
nfr: []
invariants: ["INV-018", "INV-029"]
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "reassign"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Laptop\" (purchase, 9000.00 BOB, sin fecha objetivo, sin cuentas vinculadas) con 1500.00 BOB reservados en \"Banco BOB\""
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1)"
  - "\"Banco BOB\" con reservado total 1500.00 BOB"
input: {"targetGoalId": "Fondo de emergencia", "fund": "EARMARK", "accountId": "Banco BOB", "amount": "1000.00 BOB"}
steps:
  - "POST W/goals/{Laptop}/reassignments"
expected_result:
  - "\"Laptop\": REASSIGN_OUT −1000.00 BOB; \"Fondo de emergencia\": REASSIGN_IN +1000.00 BOB; mismo reassignment_id"
  - "Reservado de \"Banco BOB\" sigue 1500.00 BOB"
  - "Dos hechos SavingsContributionRecorded.v1 y una auditoría por meta"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-027 — Reasignar una reserva entre metas registra dos movimientos ligados y no cambia lo reservado de la cuenta

## Intención

FR-GOALS-005: reasignar es explícito y atómico.

## Escenario

```gherkin
Dada "Laptop" con 1500.00 BOB reservados en "Banco BOB"
Cuando el EDITOR reasigna 1000.00 BOB a "Fondo de emergencia"
Entonces "Laptop" registra −1000.00 BOB y "Fondo de emergencia" +1000.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
