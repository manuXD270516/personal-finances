---
id: TC-REPORTING-DASHBOARD-006
title: "El resumen refleja de inmediato un gasto recién posteado y declara su frescura"
spec: reporting/dashboard
related_specs: []
requirement: "Frescura y lectura inmediata del resumen"
scenario: "Gasto recién registrado"
requirement_status: confirmed
fr: ["FR-REPORTING-007","FR-REPORTING-002"]
nfr: ["NFR-PERF-004"]
invariants: ["INV-022"]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["dashboard","read-your-writes","freshness"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "FixedClock en 2026-09-30T18:00:00-04:00 salvo indicación"
  - "\"Banco BOB\" 685.00 BOB, \"Caja BOB\" 120.50 BOB, \"Wallet USDT\" 50.000000 USDT (ASSET, líquidas, incluidas en patrimonio)"
  - "Gastos de septiembre previos: 1305.00 BOB"
input: {"post_expense":"50.00 BOB (Supermercado, 2026-09-30)","then":"GET /reports/summary?month=2026-09"}
steps:
  - "POST de un gasto de 50.00 BOB"
  - "GET del resumen inmediatamente"
expected_result:
  - "Gastos del mes = 1355.00 BOB"
  - "meta incluye period 2026-09-01..2026-09-30, reportingCurrency BOB, generatedAt y dataFreshness"
  - "La respuesta lleva ETag; un If-None-Match con el ETag previo no devuelve 304"
created: 2026-10-02
updated: 2026-10-02
---

# TC-REPORTING-DASHBOARD-006 — El resumen refleja de inmediato un gasto recién posteado y declara su frescura

## Intención

Read-your-writes (docs/14 §2.2): el usuario no debe dudar si su gasto se registró.

## Escenario

```gherkin
Cuando posteo un gasto de 50.00 BOB y consulto el resumen
Entonces los gastos del mes incluyen los 50.00 BOB
  Y la respuesta declara periodo, moneda, generación y frescura
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
