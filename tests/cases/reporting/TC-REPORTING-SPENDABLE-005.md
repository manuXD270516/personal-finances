---
id: TC-REPORTING-SPENDABLE-005
title: "Lo reservado por metas en una cuenta sobre-asignada resta como máximo su saldo y las reservas en cuentas no líquidas no restan"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Reservas de metas descontadas del disponible"
scenario: "Cuenta sobre-asignada descuenta como máximo su saldo"
requirement_status: provisional
fr: ["FR-GOALS-004", "FR-PLANNING-024"]
nfr: []
invariants: []
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5", "goals", "earmark"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (periodo \"2026-10\")"
  - "Única cuenta líquida \"Banco BOB\" 1500.00 BOB con 2000.00 BOB reservados por metas"
  - "\"Inversión\" (ILLIQUID) con 4000.00 BOB reservados para \"Auto\""
  - "Sin compromisos, aportes planificados ni reserva mínima"
input: {}
steps:
  - "Calcular el disponible"
expected_result:
  - "reservedForGoals 1500.00 BOB"
  - "spendable 0.00 BOB (no −500.00 BOB)"
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-005 — Lo reservado por metas en una cuenta sobre-asignada resta como máximo su saldo y las reservas en cuentas no líquidas no restan

## Intención

La sobre-asignación se avisa aparte (add-savings-goals); Q5 no la resta dos veces (pregunta 8).

## Escenario

```gherkin
Dado "Banco BOB" con 1500.00 BOB y 2000.00 BOB reservados
Cuando calculo el disponible
Entonces lo reservado que resta es 1500.00 BOB
  Y el disponible es 0.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
