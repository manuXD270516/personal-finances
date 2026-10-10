---
id: TC-GOALS-SAVINGS-049
title: "La transferencia de un aporte tiene origen goal, se filtra por origen, muestra su meta y no es ingreso ni gasto"
spec: transactions/transfers
related_specs: ["goals/savings-goals"]
requirement: "Transferencias de aportes y retiros de metas"
scenario: "Transferencia de un aporte"
requirement_status: provisional
fr: ["FR-TRANSACTIONS-003", "FR-GOALS-002"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "transactions", "transfers"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1)"
input: {"contribution": "1000.00 BOB Banco BOB → Ahorro BOB"}
steps:
  - "Aportar a la meta"
  - "GET W/transactions?source=GOAL"
  - "GET W/goals/transaction-links?transactionIds=<id>"
  - "GET W/reports/summary"
  - "Anular la transferencia desde Transactions"
expected_result:
  - "La transferencia aparece en el filtro con source GOAL"
  - "El enlace indica \"Fondo de emergencia\""
  - "Ingresos y gastos del mes sin cambios"
  - "La anulación se acepta y el enlace sigue indicando la meta (con el inverso)"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-049 — La transferencia de un aporte tiene origen goal, se filtra por origen, muestra su meta y no es ingreso ni gasto

## Intención

FR-TRANSACTIONS-003: la transacción referencia la meta.

## Escenario

```gherkin
Cuando el EDITOR aporta 1000.00 BOB a "Fondo de emergencia"
Entonces la transferencia aparece filtrando por origen goal
  Y su detalle indica "Fondo de emergencia"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
