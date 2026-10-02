---
id: TC-TRANSACTIONS-CONVERSION-006
title: "Fees mayores al monto entregado o en tercera moneda sin cuenta pagadora se rechazan"
spec: transactions/conversions
related_specs: []
requirement: "Consistencia entre montos y comisiones"
scenario: "Fee mayor que el monto entregado"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-022"]
nfr: []
invariants: ["INV-010"]
priority: high
type: unit
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["conversion","validation","fees"]
error_code: "CONVERSION_AMOUNTS_INCONSISTENT"
preconditions:
  - "ConversionCalculator del dominio"
input: {"case_1":{"source":"1.000000 USDT","fee_source":"1.500000 USDT","target":"6.85 BOB"},"case_2":{"network_fee":"15.000000 TRX","paidFromAccount":null}}
steps:
  - "Validar el caso 1"
  - "Validar el caso 2"
expected_result:
  - "Ambos casos se rechazan con CONVERSION_AMOUNTS_INCONSISTENT"
  - "No se crea transacción ni asiento"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-CONVERSION-006 — Fees mayores al monto entregado o en tercera moneda sin cuenta pagadora se rechazan

## Intención

INV-010: los montos del detalle deben reconciliar con los postings; un fee imposible rompería el cuadre.

## Escenario

```gherkin
Cuando entrego 1.000000 USDT con un fee de 1.500000 USDT descontado del origen
Entonces la operación se rechaza con CONVERSION_AMOUNTS_INCONSISTENT
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
