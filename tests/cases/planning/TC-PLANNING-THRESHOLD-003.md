---
id: TC-PLANNING-THRESHOLD-003
title: 'Cruzar el 50 % emite un único hecho de umbral alcanzado'
spec: planning/budgets
related_specs: ['notifications/alerts']
requirement: 'Cruce de umbral emitido una sola vez por umbral y periodo'
scenario: 'Cruce del 50 %'
requirement_status: confirmed
fr: ['FR-PLANNING-022']
nfr: []
invariants: ['INV-034']
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 2
tags: ['budgets', 'thresholds', 'events', 'outbox']
error_code: null
preconditions:
  - 'Periodo "2026-11" (2026-11-01 a 2026-11-30) en estado activo con plan en BOB'
  - '"Restaurantes" máximo 600.00 BOB con umbrales por defecto y gastado 280.00 BOB'
input:
  expense: '30.00 BOB Restaurantes'
steps:
  - 'Postear el gasto'
  - 'Procesar el evento transactions.TransactionPosted.v1 en el consumidor planning.budget-thresholds'
expected_result:
  - 'Se registra el cruce del 50 % de "Restaurantes" en "2026-11"'
  - 'El outbox contiene un único planning.BudgetThresholdReached.v1 con threshold "50", reference 600.00 BOB y actual 310.00 BOB'
  - 'El payload valida contra su JSON Schema'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-THRESHOLD-003 — Cruzar el 50 % emite un único hecho de umbral alcanzado

## Intención

FR-PLANNING-022: el hecho que alimenta las alertas.

## Escenario

```gherkin
Dado "Restaurantes" con máximo 600.00 BOB y gastado 280.00 BOB
Cuando se postea un gasto de 30.00 BOB
Entonces se emite un único hecho de umbral 50 % con gastado 310.00 BOB
```

## Notas

