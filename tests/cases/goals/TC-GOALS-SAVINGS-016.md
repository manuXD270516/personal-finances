---
id: TC-GOALS-SAVINGS-016
title: "Un gasto que deja la cuenta por debajo de lo reservado la marca sobre-asignada y publica un hecho por episodio"
spec: goals/savings-goals
related_specs: []
requirement: "Meta sobre-asignada cuando el saldo cae"
scenario: "Gasto que deja la cuenta sobre-asignada"
requirement_status: provisional
fr: ["FR-GOALS-004", "FR-NOTIFY-004"]
nfr: ["NFR-PERF-008"]
invariants: ["INV-018", "INV-028"]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "over-allocation", "events"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "\"Banco BOB\" saldo 7000.00 BOB, reservado 7000.00 BOB entre \"Laptop\" y \"Fondo de emergencia\""
  - "Worker con el consumidor goals.balance-watch"
input: {"expense": {"amount": "1200.00", "currency": "BOB", "account": "Banco BOB"}}
steps:
  - "Postear el gasto"
  - "Entregar ledger.JournalEntryPosted.v1 al consumidor (dos veces)"
  - "GET W/goals/reservations y GET W/goals"
expected_result:
  - "\"Banco BOB\" OVER_ALLOCATED con shortfall 1200.00 BOB; \"Laptop\" y \"Fondo de emergencia\" con overAllocated = true"
  - "Un único goals.EarmarkExceedsBalance.v1 con episodeId en el outbox, aunque el hecho de ledger se entregue dos veces"
  - "Lag ≤ 5 s p95"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-016 — Un gasto que deja la cuenta por debajo de lo reservado la marca sobre-asignada y publica un hecho por episodio

## Intención

FR-GOALS-004: si el saldo cae por debajo de lo reservado, la meta se marca y se avisa una vez.

## Escenario

```gherkin
Dado "Banco BOB" con 7000.00 BOB todos reservados
Cuando se postea un gasto de 1200.00 BOB
Entonces la cuenta y sus metas quedan sobre-asignadas con faltante 1200.00 BOB
  Y se publica un único hecho de sobre-asignación
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
