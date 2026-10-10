---
id: TC-GOALS-SAVINGS-037
title: "Alcanzar el objetivo publica GoalReached una vez por alcance y un retiro que la deja por debajo la reabre"
spec: goals/savings-goals
related_specs: []
requirement: "Meta alcanzada"
scenario: "Laptop alcanzada"
requirement_status: provisional
fr: ["FR-GOALS-008"]
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "reached", "events"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Laptop\" (purchase, 9000.00 BOB, sin fecha objetivo, sin cuentas vinculadas) con 8500.00 BOB reservados en \"Banco BOB\""
  - "FixedClock en 2026-10-20"
input: {"steps": ["+500.00", "+100.00", "-600.00", "+500.00"]}
steps:
  - "Reservar 500.00 BOB"
  - "Reservar 100.00 BOB"
  - "Liberar 600.00 BOB"
  - "Reservar 500.00 BOB"
expected_result:
  - "Tras +500.00: ACHIEVED y un goals.GoalReached.v1 con reachedOn 2026-10-20 y trigger MOVEMENT"
  - "Tras +100.00: sin hecho nuevo"
  - "Tras −600.00: ACTIVE (REOPEN) con 8500.00 BOB"
  - "Tras +500.00: ACHIEVED otra vez y un hecho nuevo"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-037 — Alcanzar el objetivo publica GoalReached una vez por alcance y un retiro que la deja por debajo la reabre

## Intención

FR-GOALS-008: un hecho por cada alcance, sin repetirlo mientras sigue alcanzada.

## Escenario

```gherkin
Dada "Laptop" con 8500.00 BOB de 9000.00 BOB
Cuando el EDITOR reserva 500.00 BOB
Entonces la meta pasa a ACHIEVED
  Y se publica un hecho de meta alcanzada
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
