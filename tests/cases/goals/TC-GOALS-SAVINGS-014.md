---
id: TC-GOALS-SAVINGS-014
title: "Una reserva mayor que el disponible de la cuenta se rechaza con EARMARK_EXCEEDS_BALANCE y su detalle"
spec: goals/savings-goals
related_specs: []
requirement: "Reservas limitadas por el saldo de la cuenta"
scenario: "Reserva mayor que el disponible"
requirement_status: provisional
fr: ["FR-GOALS-004"]
nfr: []
invariants: ["INV-018"]
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "earmark", "guard"]
error_code: EARMARK_EXCEEDS_BALANCE
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "\"Banco BOB\" saldo 7000.00 BOB, reservado 3500.00 BOB"
input: {"fund": "EARMARK", "amount": {"amount": "3600.00", "currency": "BOB"}, "goal": "Laptop"}
steps:
  - "POST …/contributions"
expected_result:
  - "422 EARMARK_EXCEEDS_BALANCE con details {balance: 7000.00 BOB, reserved: 3500.00 BOB, available: 3500.00 BOB}"
  - "Sin movimiento"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-014 — Una reserva mayor que el disponible de la cuenta se rechaza con EARMARK_EXCEEDS_BALANCE y su detalle

## Intención

INV-018: Σ reservado ≤ saldo al registrar.

## Escenario

```gherkin
Dado "Banco BOB" con 3500.00 BOB disponibles para reservar
Cuando el EDITOR reserva 3600.00 BOB
Entonces se rechaza con EARMARK_EXCEEDS_BALANCE
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
