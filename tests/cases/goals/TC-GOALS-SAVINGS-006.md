---
id: TC-GOALS-SAVINGS-006
title: "Pausar y reanudar una meta son transiciones auditadas y la meta pausada sigue aceptando movimientos"
spec: goals/savings-goals
related_specs: []
requirement: "Estados y transiciones de una meta"
scenario: "Pausar y reanudar"
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
tags: ["goals", "state", "lifecycle"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1)"
input: {}
steps:
  - "POST …/pause con If-Match"
  - "Reservar 100.00 BOB de \"Banco BOB\" para la meta pausada"
  - "POST …/resume con If-Match"
expected_result:
  - "La meta pasa a PAUSED, acepta la reserva y vuelve a ACTIVE"
  - "Auditoría de PAUSE y RESUME con actor y versión"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-006 — Pausar y reanudar una meta son transiciones auditadas y la meta pausada sigue aceptando movimientos

## Intención

La máquina de estados de la meta (D37) solo cambia por transiciones explícitas; pausar no congela el dinero.

## Escenario

```gherkin
Cuando el EDITOR pausa "Fondo de emergencia"
Entonces la meta queda PAUSED
Cuando la reanuda
Entonces vuelve a ACTIVE
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
