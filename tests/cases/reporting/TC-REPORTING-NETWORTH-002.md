---
id: TC-REPORTING-NETWORTH-002
title: "El patrimonio se desglosa por moneda y por tipo de cuenta"
spec: reporting/net-worth
related_specs: []
requirement: "Desglose del patrimonio por moneda y tipo de cuenta"
scenario: "Desglose del ejemplo"
requirement_status: confirmed
fr: ["FR-REPORTING-005"]
nfr: []
invariants: []
priority: high
type: unit
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/report-summary.queries.test.ts
  - packages/contexts/reporting/src/domain/net-worth-valuator.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["net-worth","breakdown"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "FixedClock en 2026-09-30T18:00:00-04:00 salvo indicación"
  - "\"Banco BOB\" 685.00 BOB, \"Caja BOB\" 120.50 BOB, \"Wallet USDT\" 50.000000 USDT (ASSET, líquidas, incluidas en patrimonio)"
  - "Tarjeta \"Visa\" (LIABILITY, BOB) con deuda 400.00 BOB"
  - "USDT/BOB PARALLEL 12.02 de paralelo.bo (provider principal) con vigencia 2026-09-30T21:53:07Z; preferencia del par PARALLEL"
input: {"asOf":"2026-09-30"}
steps:
  - "Calcular el desglose"
expected_result:
  - "Por moneda: BOB activos 805.50, pasivos 400.00, neto 405.50; USDT 50.000000 → 601.00 BOB"
  - "Por tipo: banco 685.00; efectivo 120.50; wallet cripto 601.00; tarjeta de crédito −400.00 (BOB)"
  - "Σ desglose por tipo = 1006.50 BOB"
created: 2026-10-02
updated: 2026-10-03
---

# TC-REPORTING-NETWORTH-002 — El patrimonio se desglosa por moneda y por tipo de cuenta

## Intención

Responder "¿de qué está hecho mi patrimonio?" sin perder la moneda original.

## Escenario

```gherkin
Dado el patrimonio de 1006.50 BOB del ejemplo
Cuando consulto su desglose
Entonces veo BOB neto 405.50 y USDT 50.000000 equivalentes a 601.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
