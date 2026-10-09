---
id: TC-REPORTING-NETWORTH-006
title: "La serie mensual informa el patrimonio de cada fin de mes"
spec: reporting/net-worth
related_specs: ["ledger/balances"]
requirement: "Serie mensual del patrimonio neto"
scenario: "Tres meses de patrimonio"
requirement_status: confirmed
fr: [FR-REPORTING-006, FR-REPORTING-005]
nfr: []
invariants: [INV-022, INV-031]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/net-worth-history.api.test.ts
  - apps/web/src/ui/networth/networth.test.tsx
  - packages/contexts/reporting/src/application/net-worth-history.queries.test.ts
  - packages/contexts/reporting/src/domain/net-worth-series.test.ts
  - packages/contexts/reporting/src/domain/net-worth.properties.test.ts
  - tests/e2e/specs/net-worth-evolution.spec.ts
status: automated
regression_suite: true
phase: 2
tags: ["net-worth", "history"]
error_code: null
preconditions:
  - "Workspace \"W1\" (BOB, America/La_Paz); cuentas \"Banco BOB\", \"Wallet USDT\" y tarjeta \"Visa\" incluidas en el patrimonio"
  - "Al 2026-01-31: 2000.00 BOB, 100.000000 USDT, deuda 300.00 BOB; USDT/BOB PARALLEL 10.00"
  - "Al 2026-02-28: 2500.00 BOB, 100.000000 USDT, deuda 0.00 BOB; USDT/BOB 10.50"
  - "Al 2026-03-31: 2400.00 BOB, 120.000000 USDT, deuda 150.00 BOB; USDT/BOB 11.00"
  - "FixedClock 2026-04-12T12:00:00-04:00"
input:
  from: "2026-01"
  to: "2026-04"
  reportingCurrency: "BOB"
steps:
  - "GET W/reports/net-worth/history"
expected_result:
  - "Enero 2700.00, febrero 3550.00, marzo 3570.00 BOB"
  - "Marzo: activos 3720.00 y pasivos 150.00 BOB"
  - "Abril calculado al 2026-04-12 con partial true"
created: 2026-10-05
updated: 2026-10-09
---

# TC-REPORTING-NETWORTH-006 — La serie mensual informa el patrimonio de cada fin de mes

## Intención

FR-REPORTING-006: evolución mensual con números verificables a mano.

## Escenario

```gherkin
Dado los saldos y tasas de fin de enero, febrero y marzo de 2026
Cuando se pide la serie de enero a marzo
Entonces informa 2700.00 BOB, 3550.00 BOB y 3570.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
