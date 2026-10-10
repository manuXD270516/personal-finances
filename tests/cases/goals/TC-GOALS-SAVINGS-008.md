---
id: TC-GOALS-SAVINGS-008
title: "Movimientos sobre una meta terminal se rechazan y las transiciones no permitidas devuelven INVALID_STATUS_TRANSITION"
spec: goals/savings-goals
related_specs: []
requirement: "Estados y transiciones de una meta"
scenario: "Aporte a una meta cancelada"
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
tags: ["goals", "state"]
error_code: GOAL_CLOSED
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Laptop\" (purchase, 9000.00 BOB, sin fecha objetivo, sin cuentas vinculadas) CANCELLED"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1) ACTIVE"
input: {}
steps:
  - "Aportar 100.00 BOB a \"Laptop\""
  - "Cerrar \"Fondo de emergencia\""
  - "Archivar \"Fondo de emergencia\""
  - "Archivar \"Laptop\""
expected_result:
  - "El aporte se rechaza con GOAL_CLOSED sin transferencia ni movimiento"
  - "Cerrar y archivar la meta activa se rechazan con INVALID_STATUS_TRANSITION"
  - "Archivar \"Laptop\" (cancelada) se acepta y la oculta del listado por defecto"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-008 — Movimientos sobre una meta terminal se rechazan y las transiciones no permitidas devuelven INVALID_STATUS_TRANSITION

## Intención

Las metas cerradas o canceladas son terminales; el archivo solo aplica a ellas.

## Escenario

```gherkin
Dada "Laptop" cancelada
Cuando el EDITOR aporta 100.00 BOB
Entonces se rechaza con GOAL_CLOSED
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
