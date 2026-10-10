---
id: TC-GOALS-SAVINGS-003
title: "Una cuenta de pasivo no puede vincularse a una meta"
spec: goals/savings-goals
related_specs: []
requirement: "Meta de ahorro con tipo, objetivo, fechas y cuentas vinculadas"
scenario: "Tarjeta de crédito como cuenta vinculada"
requirement_status: provisional
fr: ["FR-GOALS-001"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "validation"]
error_code: GOAL_ACCOUNT_NOT_ELIGIBLE
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
input: {"linkedAccountIds": ["Tarjeta X"]}
steps:
  - "Crear una meta vinculada a \"Tarjeta X\""
  - "Editar \"Fondo de emergencia\" agregando \"Tarjeta X\""
expected_result:
  - "Ambos comandos se rechazan con GOAL_ACCOUNT_NOT_ELIGIBLE"
  - "No cambia nada"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-003 — Una cuenta de pasivo no puede vincularse a una meta

## Intención

El ahorro de una meta vive en activos; vincular un pasivo haría que un pago de tarjeta cuente como ahorro.

## Escenario

```gherkin
Cuando el EDITOR crea una meta vinculada a "Tarjeta X"
Entonces se rechaza con GOAL_ACCOUNT_NOT_ELIGIBLE
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
