---
id: TC-GOALS-SAVINGS-023
title: "Revisar la transferencia de un aporte reemplaza el aporte por el monto revisado o lo revierte si el destino deja de estar vinculado"
spec: goals/savings-goals
related_specs: []
requirement: "Anulación o revisión de la transacción de un movimiento"
scenario: "Transferencia revisada a 450.00 BOB"
requirement_status: provisional
fr: ["FR-GOALS-002"]
nfr: []
invariants: ["INV-018", "INV-028"]
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "revision", "events"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1) con 1500.00 BOB, 500.00 BOB por la transferencia vinculada (revisión 1)"
input: {"revision2": {"amount": "450.00 BOB", "to": "Ahorro BOB"}, "alternativa": {"to": "Efectivo BOB"}}
steps:
  - "Revisar la transferencia a 450.00 BOB y entregar TransferRevised.v1"
  - "En otro escenario, revisar el destino a \"Efectivo BOB\""
expected_result:
  - "Caso 1: REVERSAL de −500.00 BOB y CONTRIBUTION de 450.00 BOB con transaction_revision 2; progreso 1450.00 BOB"
  - "Caso 2: solo el REVERSAL; progreso 1000.00 BOB"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-023 — Revisar la transferencia de un aporte reemplaza el aporte por el monto revisado o lo revierte si el destino deja de estar vinculado

## Intención

El aporte siempre coincide con el monto vigente de su transferencia (INV-018).

## Escenario

```gherkin
Dado un aporte de 500.00 BOB respaldado por una transferencia
Cuando la transferencia se revisa a 450.00 BOB
Entonces la meta registra −500.00 BOB y +450.00 BOB
  Y acumula 1450.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
