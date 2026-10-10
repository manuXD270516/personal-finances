---
id: TC-GOALS-SAVINGS-040
title: "Una transferencia manual a una cuenta vinculada se sugiere como aporte y solo se registra al confirmarla"
spec: goals/savings-goals
related_specs: []
requirement: "Transferencia a una cuenta vinculada sugerida como aporte"
scenario: "Sugerencia confirmada"
requirement_status: provisional
fr: ["FR-GOALS-010", "FR-GOALS-002"]
nfr: []
invariants: ["INV-028"]
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "suggestion"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1)"
  - "\"Ahorro BOB\" vinculada solo a \"Fondo de emergencia\""
input: {"transfer": "700.00 BOB Banco BOB → Ahorro BOB"}
steps:
  - "Postear la transferencia manual y entregar TransferCompleted.v1"
  - "Confirmar la sugerencia"
  - "Repetir con otra transferencia y descartarla"
expected_result:
  - "Sugerencia PENDING de 700.00 BOB para \"Fondo de emergencia\" sin movimiento"
  - "Al confirmar: aporte REAL de 700.00 BOB con origen SUGGESTION"
  - "Descartada: sin aporte y sin nueva sugerencia de esa transferencia"
  - "Una transferencia con source GOAL no genera sugerencia"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-040 — Una transferencia manual a una cuenta vinculada se sugiere como aporte y solo se registra al confirmarla

## Intención

Nunca se registra un aporte sin confirmación (como D121 en matching).

## Escenario

```gherkin
Cuando se postea una transferencia manual de 700.00 BOB hacia "Ahorro BOB"
Entonces existe una sugerencia de aporte para "Fondo de emergencia"
Cuando el EDITOR la confirma
Entonces la meta registra un aporte real de 700.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
