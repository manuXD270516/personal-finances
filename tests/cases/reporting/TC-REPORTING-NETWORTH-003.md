---
id: TC-REPORTING-NETWORTH-003
title: "Una cuenta excluida del patrimonio no suma aunque aparezca en saldos"
spec: reporting/net-worth
related_specs: ["accounts/account-management"]
requirement: "Cuentas excluidas del patrimonio"
scenario: "Caja de terceros excluida"
requirement_status: confirmed
fr: ["FR-REPORTING-005","FR-ACCOUNTS-011"]
nfr: []
invariants: []
priority: high
type: unit
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["net-worth","include-in-net-worth"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "FixedClock en 2026-09-30T18:00:00-04:00 salvo indicación"
  - "\"Banco BOB\" 685.00 BOB, \"Caja BOB\" 120.50 BOB, \"Wallet USDT\" 50.000000 USDT (ASSET, líquidas, incluidas en patrimonio)"
  - "Tarjeta \"Visa\" (LIABILITY, BOB) con deuda 400.00 BOB"
  - "USDT/BOB PARALLEL 12.02 de paralelo.bo (provider principal) con vigencia 2026-09-30T21:53:07Z; preferencia del par PARALLEL"
  - "\"Caja oficina\" 1000.00 BOB con includeInNetWorth = false"
input: {"asOf":"2026-09-30"}
steps:
  - "Calcular patrimonio y saldos por cuenta"
expected_result:
  - "Patrimonio neto = 1006.50 BOB"
  - "\"Caja oficina\" aparece con 1000.00 BOB en accounts"
created: 2026-10-02
updated: 2026-10-02
---

# TC-REPORTING-NETWORTH-003 — Una cuenta excluida del patrimonio no suma aunque aparezca en saldos

## Intención

FR-ACCOUNTS-011: dinero de terceros administrado no es patrimonio propio.

## Escenario

```gherkin
Dada "Caja oficina" con 1000.00 BOB excluida del patrimonio
Cuando consulto el patrimonio neto
Entonces sigue siendo 1006.50 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
