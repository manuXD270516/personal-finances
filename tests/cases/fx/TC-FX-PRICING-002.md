---
id: TC-FX-PRICING-002
title: "El spread se calcula en porcentaje y monto para venta y compra de USDT"
spec: fx/conversion-pricing
related_specs: ["transactions/conversions"]
requirement: "Spread frente a la tasa de referencia"
scenario: "Ejemplo canónico de venta USDT a BOB"
requirement_status: confirmed
fr: ["FR-FX-007","FR-TRANSACTIONS-022"]
nfr: ["NFR-DATA-002"]
invariants: ["INV-020"]
priority: critical
type: unit
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["fx","spread"]
error_code: null
preconditions:
  - "ConversionCalculator del dominio (decimal.js precisión 40, HALF_EVEN)"
input: {"sell":{"converted_base":"100.000000 USDT","quoted":"6.90","reference":"6.95"},"buy":{"converted_base":"100.000000 USDT","paid":"700.00 BOB","quoted":"7.00","reference":"6.95"}}
steps:
  - "Calcular el spread de la venta"
  - "Calcular el spread de la compra"
expected_result:
  - "Venta: spreadPct = (6.95 − 6.90) / 6.95 × 100 = 0.719424460431654676; spreadAmount = 5.00 BOB"
  - "Compra: spreadPct = (7.00 − 6.95) / 6.95 × 100 = 0.719424460431654676; spreadAmount = 5.00 BOB"
  - "Signo positivo = desfavorable al usuario en ambos casos"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-PRICING-002 — El spread se calcula en porcentaje y monto para venta y compra de USDT

## Intención

El spread explica el costo oculto de la tasa P2P frente a la referencia; un error de orientación invertiría el signo.

## Escenario

```gherkin
Dada una venta de 100.000000 USDT a cotizada 6.90 con referencia 6.95
Cuando calculo el spread
Entonces es 0.719424460431654676 %
  Y su monto es 5.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
