---
id: TC-GOALS-SAVINGS-029
title: "El saldo acumulado es siempre la suma de los movimientos y los movimientos no se editan ni se borran"
spec: goals/savings-goals
related_specs: []
requirement: "Historial de movimientos inmutable y auditado"
scenario: "Saldo igual a la suma de movimientos"
requirement_status: provisional
fr: ["FR-GOALS-005"]
nfr: []
invariants: ["INV-018", "INV-029"]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "append-only", "pbt"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1)"
input: {"movements": ["+1000.00", "+500.00", "-500.00 (REVERSAL)", "-400.00 (WITHDRAWAL)"]}
steps:
  - "Registrar los movimientos de input"
  - "Intentar PATCH/DELETE de un movimiento por API"
  - "Intentar UPDATE/DELETE de goals.goal_movement con pf_app"
  - "PBT: secuencias aleatorias de comandos aceptados"
expected_result:
  - "Progreso 600.00 BOB"
  - "API: 405 (la operación no existe)"
  - "BD: PF003 por forbid_mutation (y sin grants)"
  - "PBT: progreso == Σ(+) − Σ(−) y ningún (meta, cuenta, fondo) negativo"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-029 — El saldo acumulado es siempre la suma de los movimientos y los movimientos no se editan ni se borran

## Intención

INV-018 y append-only: la historia de una meta es auditable y reconstruible.

## Escenario

```gherkin
Dados los movimientos +1000.00, +500.00, −500.00 y −400.00 BOB
Cuando consulto la meta
Entonces su saldo acumulado es 600.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
