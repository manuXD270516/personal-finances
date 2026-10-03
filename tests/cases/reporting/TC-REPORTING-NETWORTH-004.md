---
id: TC-REPORTING-NETWORTH-004
title: "Sin tasa vigente para BTC el patrimonio se marca incompleto y lista el BTC no valorado"
spec: reporting/net-worth
related_specs: ["fx/market-rates"]
requirement: "Patrimonio incompleto por falta de tasa"
scenario: "Wallet BTC sin tasa"
requirement_status: confirmed
fr: ["FR-REPORTING-005","FR-FX-004"]
nfr: []
invariants: []
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/report-summary.queries.test.ts
  - packages/contexts/reporting/src/domain/net-worth-valuator.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["net-worth","missing-rate"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "FixedClock en 2026-09-30T18:00:00-04:00 salvo indicación"
  - "\"Banco BOB\" 685.00 BOB, \"Caja BOB\" 120.50 BOB, \"Wallet USDT\" 50.000000 USDT (ASSET, líquidas, incluidas en patrimonio)"
  - "Tarjeta \"Visa\" (LIABILITY, BOB) con deuda 400.00 BOB"
  - "USDT/BOB PARALLEL 12.02 de paralelo.bo (provider principal) con vigencia 2026-09-30T21:53:07Z; preferencia del par PARALLEL"
  - "\"Wallet BTC\" 0.01000000 BTC sin tasa BTC/BOB"
input: {"asOf":"2026-09-30"}
steps:
  - "Calcular el patrimonio neto"
expected_result:
  - "netWorth = 1006.50 BOB con complete = false"
  - "unvalued = [0.01000000 BTC] con advertencia"
  - "Nunca 1:1 ni tasa fuera de la ventana"
created: 2026-10-02
updated: 2026-10-03
---

# TC-REPORTING-NETWORTH-004 — Sin tasa vigente para BTC el patrimonio se marca incompleto y lista el BTC no valorado

## Intención

Un patrimonio que omite en silencio un activo es peor que uno marcado incompleto.

## Escenario

```gherkin
Dada "Wallet BTC" con 0.01000000 BTC y sin tasa BTC/BOB
Cuando consulto el patrimonio neto
Entonces es 1006.50 BOB marcado como incompleto
  Y 0.01000000 BTC figura como no valorado
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
