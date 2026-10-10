---
id: TC-GOALS-SAVINGS-039
title: "El aporte programado crea un compromiso administrado por la meta y cada ocurrencia aprobada se registra como aporte real"
spec: goals/savings-goals
related_specs: ["commitments/recurrence-engine"]
requirement: "Aporte recurrente programado"
scenario: "Aporte mensual de 1500.00 BOB programado"
requirement_status: provisional
fr: ["FR-GOALS-009", "FR-COMMITMENTS-001"]
nfr: []
invariants: ["INV-013", "INV-018", "INV-028"]
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "plan", "recurring"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1)"
  - "FixedClock en 2026-10-10"
input: {"monthlyAmount": "1500.00 BOB", "fund": "REAL", "sourceAccountId": "Banco BOB", "destinationAccountId": "Ahorro BOB", "dayOfMonth": 5, "automation": "RECURRING", "materialization": "PENDING_APPROVAL"}
steps:
  - "PUT …/plan"
  - "Aprobar la ocurrencia del 2026-11-05"
  - "Entregar RecurringOccurrenceMaterialized.v1 (managedBy GOAL) dos veces"
  - "Pausar la definición desde W/recurring/{id}/pause"
  - "Pausar la meta"
expected_result:
  - "Definición TRANSFER de 1500.00 BOB managedBy GOAL con ocurrencia 2026-11-05"
  - "Un único aporte REAL de 1500.00 BOB con origen RECURRING que referencia la transferencia"
  - "Pausar desde recurring: 409 RECURRING_MANAGED_EXTERNALLY"
  - "Pausar la meta pausa la definición"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-039 — El aporte programado crea un compromiso administrado por la meta y cada ocurrencia aprobada se registra como aporte real

## Intención

FR-GOALS-009: el aporte planificado se ejecuta con el motor sin divergencias (pregunta 4).

## Escenario

```gherkin
Dado el aporte de 1500.00 BOB programado el día 5
Cuando el EDITOR aprueba la ocurrencia del 2026-11-05
Entonces la meta registra un aporte real de 1500.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
