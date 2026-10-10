---
id: TC-GOALS-SAVINGS-013
title: "Lo reservado de una cuenta suma reservas y aportes reales que siguen en ella, y el disponible es saldo menos reservado"
spec: goals/savings-goals
related_specs: []
requirement: "Reservado y disponible por cuenta"
scenario: "Banco con dos reservas y ahorro con aportes reales"
requirement_status: provisional
fr: ["FR-GOALS-004"]
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
tags: ["goals", "earmark", "reservations"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "\"Banco BOB\" saldo 7000.00 BOB con reservas de 2000.00 BOB (\"Laptop\") y 1500.00 BOB (\"Fondo de emergencia\")"
  - "\"Ahorro BOB\" saldo 1000.00 BOB con 1000.00 BOB de aportes reales de \"Fondo de emergencia\""
  - "Una meta CANCELLED con 300.00 BOB reales en \"Ahorro BOB\" (no cuentan)"
input: {}
steps:
  - "GET W/goals/reservations"
expected_result:
  - "\"Banco BOB\": balance 7000.00, reserved 3500.00, available 3500.00 BOB, con el detalle por meta"
  - "\"Ahorro BOB\": balance 1000.00, reserved 1000.00, available 0.00 BOB"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-013 — Lo reservado de una cuenta suma reservas y aportes reales que siguen en ella, y el disponible es saldo menos reservado

## Intención

Es la base del límite de reservas, de la sobre-asignación y de Q5 (add-spendable-amount); un error aquí reserva dos veces el mismo dinero.

## Escenario

```gherkin
Dado "Banco BOB" con 7000.00 BOB y reservas de 2000.00 y 1500.00 BOB
Cuando consulto las reservas
Entonces "Banco BOB" informa reservado 3500.00 BOB y disponible 3500.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
- Pregunta abierta 2 de design.md: si se elige (b), "Ahorro BOB" informaría reservado 0.00 BOB.
