---
id: TC-GOALS-SAVINGS-021
title: "Una transferencia que ya es aporte de una meta no puede vincularse a otra, ni en concurrencia"
spec: goals/savings-goals
related_specs: []
requirement: "Vincular una transacción existente como aporte real"
scenario: "Transferencia ya vinculada"
requirement_status: provisional
fr: ["FR-GOALS-010"]
nfr: []
invariants: ["INV-018"]
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "link", "concurrency"]
error_code: GOAL_TRANSACTION_ALREADY_LINKED
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1)"
  - "Meta \"Laptop\" vinculada también a \"Ahorro BOB\""
  - "Transferencia POSTED de 500.00 BOB hacia \"Ahorro BOB\""
input: {}
steps:
  - "Vincularla a \"Fondo de emergencia\""
  - "Vincularla a \"Laptop\""
  - "Lanzar en paralelo dos vínculos de otra transferencia a las dos metas"
expected_result:
  - "El segundo vínculo se rechaza con 409 GOAL_TRANSACTION_ALREADY_LINKED"
  - "En paralelo exactamente uno gana (índice único parcial) y el otro recibe 409"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-021 — Una transferencia que ya es aporte de una meta no puede vincularse a otra, ni en concurrencia

## Intención

Un mismo peso no puede contar como aporte de dos metas.

## Escenario

```gherkin
Dada la transferencia de 500.00 BOB vinculada a "Fondo de emergencia"
Cuando el EDITOR la vincula a "Laptop"
Entonces se rechaza con GOAL_TRANSACTION_ALREADY_LINKED
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
