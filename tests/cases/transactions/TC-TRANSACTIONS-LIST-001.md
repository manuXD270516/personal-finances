---
id: TC-TRANSACTIONS-LIST-001
title: "El listado combina filtros y pagina por cursor sin repetir ni omitir transacciones"
spec: transactions/transaction-recording
related_specs: []
requirement: "Listado y filtrado de transacciones"
scenario: "Gastos de marzo en una cuenta y categoría"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-012]
nfr: [NFR-PERF-001]
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["list", "filters", "pagination"]
error_code: null
preconditions:
  - "En Bank A: gastos Groceries 45.90 BOB (2026-03-10), 150.00 BOB (2026-03-15), 200.00 BOB (2026-03-05)"
  - "Ruido: gasto Groceries en Bank B (2026-03-12), ingreso en Bank A (2026-03-01), gasto Groceries en Bank A del 2026-04-01, gasto void en Bank A (2026-03-20)"
input:
  accountId: "Bank A"
  kind: "EXPENSE"
  categoryId: "Groceries"
  status: "POSTED"
  dateFrom: "2026-03-01"
  dateTo: "2026-03-31"
  limit: 2
  sort: "-transactionDate"
steps:
  - "Pedir la primera página"
  - "Pedir la segunda página con el cursor devuelto"
  - "Repetir filtrando por una categoría padre de Groceries"
expected_result:
  - "Página 1: 150.00 (2026-03-15) y 45.90 (2026-03-10) con nextCursor"
  - "Página 2: 200.00 (2026-03-05) sin nextCursor"
  - "Ninguna transacción de ruido aparece; ninguna se repite"
  - "El filtro por la categoría padre incluye las de sus subcategorías"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-LIST-001 — El listado combina filtros y pagina por cursor sin repetir ni omitir transacciones

## Intención

Listado base del registro de transacciones (FR-TRANSACTIONS-012) con paginación estable.

## Escenario

```gherkin
Dado tres gastos de Groceries en "Bank A" en marzo
Cuando el usuario los lista con límite 2
Entonces la primera página trae dos y un cursor
  Y la segunda página trae el restante
```
