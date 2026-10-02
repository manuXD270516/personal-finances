---
id: TC-REPORTING-NETWORTH-001
title: "El patrimonio neto actual es activos menos pasivos valorados en BOB con la tasa informada"
spec: reporting/net-worth
related_specs: ["fx/market-rates","fx/market-rate-providers","ledger/balances"]
requirement: "Patrimonio neto actual en la moneda de reporte"
scenario: "Activos en BOB y USDT con tarjeta de crédito"
requirement_status: confirmed
fr: ["FR-REPORTING-005","FR-FX-006","FR-FX-010","FR-FX-014"]
nfr: []
invariants: ["INV-031","INV-020"]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["net-worth","valuation"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "FixedClock en 2026-09-30T18:00:00-04:00 salvo indicación"
  - "\"Banco BOB\" 685.00 BOB, \"Caja BOB\" 120.50 BOB, \"Wallet USDT\" 50.000000 USDT (ASSET, líquidas, incluidas en patrimonio)"
  - "Tarjeta \"Visa\" (LIABILITY, BOB) con deuda 400.00 BOB"
  - "USDT/BOB PARALLEL 12.02 de paralelo.bo (provider principal) con vigencia 2026-09-30T21:53:07Z; preferencia del par PARALLEL"
input: {"asOf":"2026-09-30"}
steps:
  - "Calcular el patrimonio neto actual"
expected_result:
  - "Activos = 805.50 + 601.00 = 1406.50 BOB"
  - "Pasivos = 400.00 BOB"
  - "Patrimonio neto = 1006.50 BOB"
  - "Tasa USDT/BOB 12.02 PARALLEL informada con \"Fuente: paralelo.bo\", vigencia 2026-09-30T21:53:07Z y antigüedad 6 min"
created: 2026-10-02
updated: 2026-10-02
---

# TC-REPORTING-NETWORTH-001 — El patrimonio neto actual es activos menos pasivos valorados en BOB con la tasa informada

## Intención

FR-REPORTING-005: la foto de patrimonio debe ser exacta y explicable.

## Escenario

```gherkin
Dados 685.00 BOB, 120.50 BOB, 50.000000 USDT y una deuda de tarjeta de 400.00 BOB con USDT/BOB PARALLEL 12.02
Cuando consulto el patrimonio neto
Entonces es 1006.50 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
