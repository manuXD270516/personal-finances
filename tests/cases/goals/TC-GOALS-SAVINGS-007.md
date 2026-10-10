---
id: TC-GOALS-SAVINGS-007
title: "Cancelar una meta libera sus reservas con movimientos explícitos y sube el disponible de la cuenta"
spec: goals/savings-goals
related_specs: []
requirement: "Estados y transiciones de una meta"
scenario: "Cancelar libera las reservas"
requirement_status: provisional
fr: ["FR-GOALS-001", "FR-GOALS-005"]
nfr: []
invariants: ["INV-018"]
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "state", "earmark"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Laptop\" (purchase, 9000.00 BOB, sin fecha objetivo, sin cuentas vinculadas) con una reserva de 2000.00 BOB sobre \"Banco BOB\""
  - "\"Banco BOB\" con saldo contable 7000.00 BOB y reservado 2000.00 BOB"
input: {"reason": "Compra postergada"}
steps:
  - "POST …/cancel con el motivo"
  - "GET W/goals/reservations?accountId=Banco BOB"
expected_result:
  - "\"Laptop\" queda CANCELLED con el motivo"
  - "Existe un movimiento EARMARK/WITHDRAWAL de −2000.00 BOB sobre \"Banco BOB\" con origen SYSTEM"
  - "El disponible para reservar de \"Banco BOB\" pasa de 5000.00 BOB a 7000.00 BOB"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-007 — Cancelar una meta libera sus reservas con movimientos explícitos y sube el disponible de la cuenta

## Intención

Una meta cancelada no puede seguir bloqueando dinero; la liberación queda en el historial, no como borrado.

## Escenario

```gherkin
Dada "Laptop" con 2000.00 BOB reservados en "Banco BOB"
Cuando el EDITOR la cancela
Entonces se registra una liberación de 2000.00 BOB
  Y el disponible para reservar de "Banco BOB" sube 2000.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
