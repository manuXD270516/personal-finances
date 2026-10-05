---
id: TC-REPORTING-NETWORTH-008
title: "Sin tasa vigente a fin de mes el punto queda incompleto y sin 1:1"
spec: reporting/net-worth
related_specs: ["fx/market-rates"]
requirement: "Punto incompleto por falta de tasa histórica"
scenario: "Diciembre sin tasa USDT"
requirement_status: provisional
fr: [FR-REPORTING-006, FR-FX-004]
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["net-worth", "fx", "incomplete"]
error_code: null
preconditions:
  - "Al 2025-12-31: \"Banco BOB\" 1800.00 BOB y \"Wallet USDT\" 100.000000 USDT"
  - "Última tasa USDT/BOB del 2025-12-20; ventana de vigencia 7 días"
input:
  from: "2025-12"
  to: "2025-12"
steps:
  - "Pedir la serie"
expected_result:
  - "Punto de diciembre 1800.00 BOB con complete false"
  - "unconverted: 100.000000 USDT"
  - "Variación de enero marcada no comparable"
created: 2026-10-05
updated: 2026-10-05
---

# TC-REPORTING-NETWORTH-008 — Sin tasa vigente a fin de mes el punto queda incompleto y sin 1:1

## Intención

Honestidad del número (FR-REPORTING-001): nunca inventar una tasa.

## Escenario

```gherkin
Dado al 2025-12-31 1800.00 BOB y 100.000000 USDT sin tasa dentro de la ventana
Cuando se pide la serie de diciembre
Entonces informa 1800.00 BOB marcado incompleto
  Y lista 100.000000 USDT como no valorado
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
