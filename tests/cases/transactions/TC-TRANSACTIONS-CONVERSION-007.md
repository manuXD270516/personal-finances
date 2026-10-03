---
id: TC-TRANSACTIONS-CONVERSION-007
title: "Montos de conversión con más decimales que la escala se rechazan sin redondear"
spec: transactions/conversions
related_specs: ["fx/market-rates"]
requirement: "Montos de la conversión respetan la escala de su moneda"
scenario: "Demasiados decimales en USDT"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-005","FR-FX-001"]
nfr: ["NFR-DATA-001"]
invariants: ["INV-003","INV-001"]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/conversion.test.ts
  - packages/contexts/transactions/src/application/conversions.service.test.ts
  - apps/api/test/api/fx-conversions.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["conversion","scale"]
error_code: "AMOUNT_SCALE_EXCEEDED"
preconditions:
  - "\"Wallet USDT\" y \"Wallet BTC\" activas"
input: {"rejected":["100.0000001 USDT","5.001 BOB (fee)"],"accepted":"0.01600000 BTC"}
steps:
  - "POST /conversions con 100.0000001 USDT"
  - "POST /conversions con fee 5.001 BOB"
  - "POST /conversions con 0.01600000 BTC recibidos"
expected_result:
  - "Los dos primeros: 422 AMOUNT_SCALE_EXCEEDED, sin redondeo silencioso"
  - "El tercero se acepta con 0.01600000 BTC exactos"
created: 2026-10-02
updated: 2026-10-03
---

# TC-TRANSACTIONS-CONVERSION-007 — Montos de conversión con más decimales que la escala se rechazan sin redondear

## Intención

INV-003: redondear en silencio un monto ingresado crearía o destruiría valor.

## Escenario

```gherkin
Cuando indico 100.0000001 USDT como monto entregado
Entonces la operación se rechaza con AMOUNT_SCALE_EXCEEDED
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
