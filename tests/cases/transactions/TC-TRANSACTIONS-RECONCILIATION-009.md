---
id: TC-TRANSACTIONS-RECONCILIATION-009
title: "Cancelar una sesión conserva las marcas cleared y permite empezar otra"
spec: transactions/reconciliation
related_specs: []
requirement: "Cancelar una sesión de reconciliación"
scenario: "Cancelar y empezar de nuevo"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-030]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["reconciliation"]
error_code: null
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE) con saldo inicial 1000.00 BOB al 2026-02-28"
  - "Gasto G1 cleared de 150.00 BOB del 2026-03-05; ingreso I1 cleared de 2500.00 BOB del 2026-03-10"
  - "Gasto G2 posted de 45.90 BOB del 2026-03-20; gasto G3 cleared de 200.00 BOB del 2026-04-02"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "Sesión S1 IN_PROGRESS en la que G2 fue confirmado"
input:
  - "{\"action\":\"cancel\",\"session\":\"S1\"}"
  - "{\"action\":\"cancel\",\"session\":\"S0 (COMPLETED)\"}"
steps:
  - "POST W/reconciliations/S1/cancel"
  - "Iniciar otra sesión para \"Bank A\""
  - "Intentar cancelar S0"
expected_result:
  - "S1 CANCELLED; G2 sigue cleared; nadie reconciled"
  - "Nueva sesión creada"
  - "S0: 409 INVALID_STATUS_TRANSITION"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-009 — Cancelar una sesión conserva las marcas cleared y permite empezar otra

## Intención

Cancelar no deshace confirmaciones (son hechos contra el banco) y libera la cuenta.

## Escenario

```gherkin
Dado una sesión en curso en la que se confirmó el gasto de 45.90 BOB
Cuando el usuario la cancela
Entonces la sesión queda CANCELLED y el gasto sigue cleared
  Y puede iniciar otra sesión
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
