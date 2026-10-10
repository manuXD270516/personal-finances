---
id: TC-GOALS-SAVINGS-001
title: "Crear una meta de ahorro con tipo, objetivo, fechas y cuenta vinculada la deja activa y sin progreso"
spec: goals/savings-goals
related_specs: []
requirement: "Meta de ahorro con tipo, objetivo, fechas y cuentas vinculadas"
scenario: "Fondo de emergencia creado"
requirement_status: provisional
fr: ["FR-GOALS-001"]
nfr: []
invariants: []
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "create"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Usuario EDITOR"
  - "FixedClock en 2026-10-01T09:00:00-04:00"
input: {"name": "Fondo de emergencia", "type": "EMERGENCY_FUND", "target": {"amount": "15000.00", "currency": "BOB"}, "startDate": "2026-10-01", "targetDate": "2027-03-31", "linkedAccountIds": ["Ahorro BOB"], "priority": 1}
steps:
  - "POST W/goals con el cuerpo de input y una Idempotency-Key"
  - "GET W/goals/{goalId}"
expected_result:
  - "201 con status ACTIVE, versión 1 y los datos enviados"
  - "progress.total = 0.00 BOB, percent = \"0.00\", remaining = 15000.00 BOB"
  - "Auditoría goals.goal.created con actor EDITOR en la misma transacción"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-001 — Crear una meta de ahorro con tipo, objetivo, fechas y cuenta vinculada la deja activa y sin progreso

## Intención

Garantiza que una meta nace activa, con sus datos y sin progreso inventado; es la base de Q9.

## Escenario

```gherkin
Dado un EDITOR del workspace W1
Cuando crea "Fondo de emergencia" por 15000.00 BOB con objetivo 2027-03-31 vinculada a "Ahorro BOB"
Entonces la meta queda ACTIVE con 0.00 BOB acumulados y 0.00 %
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
