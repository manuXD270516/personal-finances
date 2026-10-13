---
id: TC-FX-PROVIDER-032
title: "El umbral de anomalía depende de la clase de activo: 5 por ciento fiat y estables, 10 por ciento cripto volátil"
spec: fx/market-rate-providers
related_specs: []
requirement: "Detección de tasas anómalas"
scenario: "Variación de cripto volátil sobre su umbral"
requirement_status: provisional
fr: ["FR-FX-010"]
nfr: []
invariants: []
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "anomaly", "asset-class", "pbt"]
error_code: null
preconditions:
  - "Umbrales por defecto 5 y 10"
input: {"cases": [["USDT/BOB", "12.02", "12.70"], ["BTC/USDT", "65000.00", "70000.00"], ["BTC/USDT", "65000.00", "72000.00"]]}
steps:
  - "Evaluar cada muestra con AnomalyDetector y AssetClassPolicy"
  - "PBT: 500 pares de valores aleatorios por clase, con timeout explícito"
expected_result:
  - "USDT/BOB 12.70 (+5.66 %) queda anómala"
  - "BTC/USDT 70000.00 (+7.69 %) se acepta"
  - "BTC/USDT 72000.00 (+10.77 %) queda anómala y la valoración sigue con 65000.00"
  - "PBT: anómala si y solo si |variación| supera el umbral de su clase"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-032 — El umbral de anomalía depende de la clase de activo: 5 por ciento fiat y estables, 10 por ciento cripto volátil

## Intención

D228: un 5 % en 15 min es posible en cripto y bloquearía la valoración sin motivo.

## Escenario

```gherkin
Dado BTC/USDT aceptado en 65000.00
Cuando llega 72000.00
Entonces la muestra queda anómala
```

## Notas

- Regresión: los scenarios de Phase 1 (13.50 USD/BOB) siguen iguales.
