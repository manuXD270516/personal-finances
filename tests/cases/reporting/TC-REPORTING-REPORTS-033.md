---
id: TC-REPORTING-REPORTS-033
title: "El cambio del patrimonio se descompone exactamente en ahorro, revalorización cambiaria y de activos"
spec: reporting/net-worth
related_specs: []
requirement: "Descomposición del cambio del patrimonio"
scenario: "Octubre con ahorro y revalorización"
requirement_status: confirmed
fr: ["FR-REPORTING-008", "FR-REPORTING-005"]
nfr: []
invariants: ["INV-031", "INV-012"]
priority: critical
type: property
level: property
automation_status: automated
automated_tests:
  - apps/api/test/api/financial-reports.api.test.ts
  - packages/contexts/reporting/src/application/financial-reports.queries.test.ts
  - packages/contexts/reporting/src/domain/reports.domain.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["net-worth", "decomposition", "pbt"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Al 2026-09-30: \"Banco BOB\" 10000.00 BOB, \"Cuenta USD\" 100.00 USD a 10.00, \"Wallet USDT\" 1000.000000 USDT a 12.00"
  - "Ahorro de octubre 8200.00 BOB; al 2026-10-31 USD/BOB 10.50 y USDT/BOB 12.50"
  - "Caso aparte: venta de 100.000000 USDT por 1190.00 BOB a 12.00"
input: {}
steps:
  - "Descomponer el cambio de 2026-10"
  - "PBT con ledgers y tasas aleatorias"
expected_result:
  - "Patrimonio 23000.00 → 31750.00 BOB; cambio 8750.00 = ahorro 8200.00 + cambiaria 50.00 (USD) + activos 500.00 (USDT)"
  - "Venta: resultado de conversiones −10.00 BOB y revalorización 0.00"
  - "PBT: ΔNW = Σ componentes a precisión 40"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-033 — El cambio del patrimonio se descompone exactamente en ahorro, revalorización cambiaria y de activos

## Intención

docs/14 §4.1: "¿subió porque ahorré o porque subió el USDT?" sin residuo sin explicar.

## Escenario

```gherkin
Dado un patrimonio de 23000.00 BOB y un ahorro de 8200.00 BOB
Cuando las tasas suben a 10.50 y 12.50
Entonces el cambio de 8750.00 BOB se descompone en 8200.00 + 50.00 + 500.00 BOB
```

## Notas

- PBT con timeout explícito (CI es más lento).
- Pregunta 4 del design: USDT se agrupa en activos por su tipo CRYPTO.
