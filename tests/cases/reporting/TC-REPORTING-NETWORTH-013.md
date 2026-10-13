---
id: TC-REPORTING-NETWORTH-013
title: "El patrimonio neto incluye bitcoin valorado con la tasa cruzada BTC/USDT por USDT/BOB"
spec: reporting/net-worth
related_specs: ["fx/market-rates", "fx/market-rate-providers"]
requirement: "Patrimonio neto actual en la moneda de reporte"
scenario: null
requirement_status: confirmed
fr: ["FR-REPORTING-005", "FR-FX-006", "FR-FX-014"]
nfr: []
invariants: ["INV-001", "INV-002"]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/report-summary.queries.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["net-worth", "crypto", "cross-rate"]
error_code: null
preconditions:
  - "\"Banco BOB\" 685.00 BOB y \"Wallet BTC\" 0.01500000 BTC"
  - "BTC/USDT MARKET 65000.00 y USDT/BOB PARALLEL 12.02 vigentes"
input: {}
steps:
  - "GET W/reports/summary (patrimonio actual)"
expected_result:
  - "Activos 12404.50 BOB (685.00 + 11719.50) y patrimonio neto 12404.50 BOB"
  - "Se informan las tasas componentes con su atribución, vigencia y antigüedad"
  - "Sin tasa BTC/USDT vigente, 0.01500000 BTC se lista sin convertir (sin 1:1)"
created: 2026-10-13
updated: 2026-10-13
---

# TC-REPORTING-NETWORTH-013 — El patrimonio neto incluye bitcoin valorado con la tasa cruzada BTC/USDT por USDT/BOB

## Intención

Criterio de la fase: el owner ve su cripto en el patrimonio sin cargar tasas a mano.

## Escenario

```gherkin
Dado 685.00 BOB y 0.01500000 BTC
Cuando se consulta el patrimonio
Entonces es 12404.50 BOB
```

## Notas

