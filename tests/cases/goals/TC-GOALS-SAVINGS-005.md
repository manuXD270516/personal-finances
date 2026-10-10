---
id: TC-GOALS-SAVINGS-005
title: "No se desvincula una cuenta con fondos reales de la meta ni se cambia la moneda de una meta con movimientos"
spec: goals/savings-goals
related_specs: []
requirement: "Edición de una meta"
scenario: "Desvincular una cuenta con fondos"
requirement_status: provisional
fr: ["FR-GOALS-001"]
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
tags: ["goals", "validation"]
error_code: GOAL_ACCOUNT_HAS_FUNDS
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1) con 1000.00 BOB de aportes reales en \"Ahorro BOB\""
input: {"unlink": "Ahorro BOB", "currency": "USD"}
steps:
  - "PATCH quitando \"Ahorro BOB\" de las cuentas vinculadas"
  - "PATCH cambiando la moneda del objetivo a USD"
expected_result:
  - "El primero se rechaza con 409 GOAL_ACCOUNT_HAS_FUNDS y la cuenta sigue vinculada"
  - "El segundo se rechaza con 409 GOAL_CURRENCY_LOCKED"
  - "La versión de la meta no cambia"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-005 — No se desvincula una cuenta con fondos reales de la meta ni se cambia la moneda de una meta con movimientos

## Intención

Los fondos reales de una meta deben estar siempre en una cuenta vinculada (INV-018) y el progreso no puede cambiar de moneda a mitad de camino.

## Escenario

```gherkin
Dado "Fondo de emergencia" con 1000.00 BOB reales en "Ahorro BOB"
Cuando el EDITOR desvincula "Ahorro BOB"
Entonces se rechaza con GOAL_ACCOUNT_HAS_FUNDS
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
