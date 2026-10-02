---
id: TC-FX-HISTORICAL-001
title: "Una conversión histórica conserva su tasa original tras agregar o corregir tasas"
spec: fx/market-rates
related_specs: ["fx/conversion-pricing", "transactions/conversions"]
requirement: "Tasas históricas inmutables"
scenario: null
requirement_status: provisional
fr: [FR-FX-001]
nfr: []
invariants: [INV-011]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["fx", "history"]
error_code: "FX_RATE_IMMUTABLE"
preconditions:
  - "Tasa de referencia USDT/BOB 6.90 para 2026-03-10 (fuente manual) con id R1"
  - "Conversión de TC-TRANSACTIONS-CONVERSION-001 registrada el 2026-03-10 referenciando R1"
input:
  new_rate:
    pair: "USDT/BOB"
    date: "2026-09-01"
    rate: "7.10"
  correction:
    pair: "USDT/BOB"
    date: "2026-03-10"
    rate: "6.92"
  direct_update: "UPDATE R1 SET rate = 6.95"
steps:
  - "Agregar la tasa del 2026-09-01"
  - "Registrar una corrección para el 2026-03-10"
  - "Intentar una actualización directa de R1"
  - "Leer la conversión, su ConversionDetail y sus postings"
expected_result:
  - "La actualización directa se rechaza con FX_RATE_IMMUTABLE; R1 no cambia"
  - "La corrección se guarda como una nueva revisión que reemplaza a R1 solo para valorizaciones futuras"
  - "ConversionDetail sigue mostrando la tasa cotizada 6.90, la efectiva 6.85 y referencia R1"
  - "Los postings de la conversión no cambian (sin recálculo)"
created: 2026-10-01
updated: 2026-10-01
---

# TC-FX-HISTORICAL-001 — Una conversión histórica conserva su tasa original tras agregar o corregir tasas

## Intención

INV-011 / ARCHITECTURE §4.2: las operaciones históricas nunca se recalculan con tasas actuales.

## Escenario

```gherkin
Dada una conversión registrada el 2026-03-10 a 6.90 BOB por USDT
Cuando se publica una nueva tasa de 7.10 para el 2026-09-01
  Y la tasa de referencia del 2026-03-10 se corrige a 6.92
Entonces la conversión sigue mostrando una tasa cotizada de 6.90
  Y sus postings no cambian
```
