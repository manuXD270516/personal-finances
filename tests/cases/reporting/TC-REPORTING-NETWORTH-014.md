---
id: TC-REPORTING-NETWORTH-014
title: "El punto de fin de mes de la serie valora bitcoin con el cierre histórico cargado por el backfill"
spec: reporting/net-worth
related_specs: ["fx/market-rate-providers"]
requirement: "Valoración histórica con la tasa de cada fin de mes"
scenario: null
requirement_status: confirmed
fr: ["FR-REPORTING-006", "FR-FX-013"]
nfr: []
invariants: ["INV-012"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/net-worth-history.queries.test.ts
  - packages/contexts/fx/src/application/crypto-rate-providers.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["net-worth", "crypto", "history", "backfill"]
error_code: null
preconditions:
  - "\"Wallet BTC\" con 0.01500000 BTC desde el 2026-03-10"
  - "Backfill BTC/USDT con cierre 82000.00 el 2026-03-31 (vigencia 2026-03-31T23:59:59Z)"
  - "USDT/BOB PARALLEL 10.20 vigente al 2026-03-31"
  - "Hoy BTC/USDT 65000.00"
input: {"month": "2026-03"}
steps:
  - "GET W/reports/net-worth/history para marzo de 2026"
expected_result:
  - "El punto de marzo valora la wallet en 12546.00 BOB (0.01500000 × 82000.00 × 10.20)"
  - "No usa 65000.00 de hoy"
  - "Informa las tasas usadas con su vigencia"
created: 2026-10-13
updated: 2026-10-13
---

# TC-REPORTING-NETWORTH-014 — El punto de fin de mes de la serie valora bitcoin con el cierre histórico cargado por el backfill

## Intención

D229: sin backfill los puntos pasados con cripto quedarían incompletos.

## Escenario

```gherkin
Dado el cierre BTC/USDT 82000.00 del 2026-03-31
Cuando se consulta el punto de marzo
Entonces la wallet vale 12546.00 BOB
```

## Notas

- Regresión: TC-FX-HISTORICAL-001/002.
