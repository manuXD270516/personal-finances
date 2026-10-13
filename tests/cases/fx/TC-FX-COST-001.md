---
id: TC-FX-COST-001
title: "El costo por canal pondera el spread por el monto convertido en la moneda de reporte"
spec: fx/conversion-pricing
related_specs: []
requirement: "Análisis de costo de conversiones por canal, par y periodo"
scenario: "Canal Binance P2P en octubre"
requirement_status: provisional
fr: ["FR-FX-011"]
nfr: []
invariants: ["INV-001", "INV-002"]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "conversion-cost", "weighted-average", "pbt"]
error_code: null
preconditions:
  - "Moneda de reporte BOB; periodo \"2026-10\""
  - "Contraparte \"Binance P2P\", cuentas \"Wallet USDT\" → \"Banco BOB\""
input: {"conversions": [{"sell": "100.000000 USDT", "quoted": "11.90", "reference": "12.00", "fee": null}, {"sell": "300.000000 USDT", "quoted": "11.94", "reference": "12.00", "fee": "2.00 BOB"}]}
steps:
  - "Agregar con ConversionCostAggregator"
  - "PBT: 500 conjuntos aleatorios de conversiones, con timeout explícito"
expected_result:
  - "2 conversiones, monto convertido 4800.00 BOB, spread promedio 0.5833 %, monto del spread 28.00 BOB, fees 2.00 BOB, costo total 30.00 BOB"
  - "PBT: spread promedio = Σ monto del spread / Σ monto convertido × 100; HALF_EVEN solo al presentar"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-COST-001 — El costo por canal pondera el spread por el monto convertido en la moneda de reporte

## Intención

D246: promedio ponderado por monto, no simple; un promedio simple daría 0.6667 % y exageraría las conversiones chicas.

## Escenario

```gherkin
Dado dos ventas de USDT por Binance P2P en octubre
Cuando se agrega el costo
Entonces el spread promedio es 0.5833 % y el costo total 30.00 BOB
```

## Notas

