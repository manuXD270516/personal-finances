---
id: TC-REPORTING-NETWORTH-007
title: "Cada punto de la serie usa la tasa de su fin de mes y no la de hoy"
spec: reporting/net-worth
related_specs: ["fx/market-rate-providers"]
requirement: "Valoración histórica con la tasa de cada fin de mes"
scenario: "Revaluación sin movimientos"
requirement_status: confirmed
fr: [FR-REPORTING-006, FR-REPORTING-011, FR-FX-006]
nfr: []
invariants: [INV-012]
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["net-worth", "fx"]
error_code: null
preconditions:
  - "\"Wallet USDT\" 100.000000 USDT sin movimientos en enero y febrero de 2026"
  - "USDT/BOB 10.00 al 2026-01-31, 10.50 al 2026-02-28, 12.02 hoy"
input:
  from: "2026-01"
  to: "2026-02"
steps:
  - "Pedir la serie"
  - "Leer meta.ratesUsed"
expected_result:
  - "Wallet 1000.00 BOB en enero y 1050.00 BOB en febrero"
  - "Ningún punto usa 12.02; cada tasa informada con fuente y vigencia"
created: 2026-10-05
updated: 2026-10-08
---

# TC-REPORTING-NETWORTH-007 — Cada punto de la serie usa la tasa de su fin de mes y no la de hoy

## Intención

INV-012: nunca se recalcula la historia con tasas actuales.

## Escenario

```gherkin
Dado 100.000000 USDT sin movimientos y tasas 10.00 y 10.50 a fin de enero y febrero
Cuando se pide la serie
Entonces la wallet vale 1000.00 BOB en enero y 1050.00 BOB en febrero
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
