---
id: TC-REPORTING-KPI-005
title: "Gastos pendientes y anulados no suman en las cifras del mes"
spec: reporting/dashboard
related_specs: ["transactions/transaction-recording"]
requirement: "Solo transacciones posteadas en las cifras"
scenario: "Pendiente y anulada excluidas"
requirement_status: confirmed
fr: ["FR-REPORTING-002","FR-TRANSACTIONS-006"]
nfr: []
invariants: ["INV-023"]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["kpi","status"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "Mes consultado: 2026-09"
input: {"expenses":[{"amount":"1200.00 BOB","status":"POSTED"},{"amount":"100.00 BOB","status":"CLEARED"},{"amount":"300.00 BOB","status":"PENDING"},{"amount":"50.00 BOB","status":"VOIDED"}]}
steps:
  - "Registrar las cuatro transacciones con PG real"
  - "Consultar los gastos del mes y las categorías"
expected_result:
  - "Gastos = 1300.00 BOB"
  - "Ni el pendiente ni el anulado aparecen en saldos ni categorías"
created: 2026-10-02
updated: 2026-10-02
---

# TC-REPORTING-KPI-005 — Gastos pendientes y anulados no suman en las cifras del mes

## Intención

INV-023: solo lo que tiene asiento activo cuenta como hecho financiero.

## Escenario

```gherkin
Dados gastos posteado 1200.00, conciliado 100.00, pendiente 300.00 y anulado 50.00 BOB
Cuando consulto los gastos del mes
Entonces son 1300.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
