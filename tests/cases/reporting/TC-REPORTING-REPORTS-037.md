---
id: TC-REPORTING-REPORTS-037
title: "El drill-down de la revalorización de activos lista las cuentas y enlaza su historial de saldo"
spec: reporting/net-worth
related_specs: []
requirement: "Drill-down del patrimonio a las cuentas"
scenario: "Revalorización de activos"
requirement_status: provisional
fr: ["FR-REPORTING-010", "FR-REPORTING-005"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["net-worth", "drill-down"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Datos de TC-REPORTING-REPORTS-033"
input:
  report: "NET_WORTH"
steps:
  - "Abrir el drill-down de la revalorización de activos de 2026-10"
expected_result:
  - "Fila \"Wallet USDT\" con 1000.000000 USDT y 500.00 BOB de revalorización"
  - "Enlace a su historial de saldo de 2026-10"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-037 — El drill-down de la revalorización de activos lista las cuentas y enlaza su historial de saldo

## Intención

El patrimonio también se explica hasta las cuentas que lo mueven.

## Escenario

```gherkin
Dado la revalorización de activos de 500.00 BOB
Cuando se abre su drill-down
Entonces se lista "Wallet USDT" con el enlace a su historial
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
