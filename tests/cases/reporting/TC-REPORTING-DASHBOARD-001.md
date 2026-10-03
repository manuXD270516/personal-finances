---
id: TC-REPORTING-DASHBOARD-001
title: "El resumen muestra saldos por cuenta y totales por moneda solo con transacciones posteadas"
spec: reporting/dashboard
related_specs: ["ledger/balances"]
requirement: "Saldos por cuenta y totales por moneda"
scenario: "Tres cuentas en dos monedas"
requirement_status: confirmed
fr: ["FR-REPORTING-003","FR-LEDGER-012"]
nfr: []
invariants: ["INV-022","INV-023"]
priority: high
type: integration
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/reports.api.test.ts
  - packages/contexts/reporting/src/application/report-summary.queries.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["dashboard","balances","multi-currency"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "FixedClock en 2026-09-30T18:00:00-04:00 salvo indicación"
  - "\"Banco BOB\" 685.00 BOB, \"Caja BOB\" 120.50 BOB, \"Wallet USDT\" 50.000000 USDT (ASSET, líquidas, incluidas en patrimonio)"
  - "Gasto pendiente de 30.00 BOB en \"Banco BOB\""
input: {"endpoint":"GET /reports/summary?month=2026-09"}
steps:
  - "Consultar el resumen del mes"
expected_result:
  - "accounts: Banco BOB 685.00 BOB; Caja BOB 120.50 BOB; Wallet USDT 50.000000 USDT"
  - "byCurrency: BOB 805.50; USDT 50.000000"
  - "El pendiente de 30.00 BOB no altera el saldo de Banco BOB"
created: 2026-10-02
updated: 2026-10-03
---

# TC-REPORTING-DASHBOARD-001 — El resumen muestra saldos por cuenta y totales por moneda solo con transacciones posteadas

## Intención

Q1 parte de saldos exactos derivados del ledger; un pendiente sumado haría creer que hay menos dinero.

## Escenario

```gherkin
Dado "Banco BOB" 685.00 BOB, "Caja BOB" 120.50 BOB y "Wallet USDT" 50.000000 USDT
Cuando consulto el resumen
Entonces veo cada saldo en su moneda
  Y los totales 805.50 BOB y 50.000000 USDT
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
