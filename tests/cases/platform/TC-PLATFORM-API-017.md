---
id: TC-PLATFORM-API-017
title: Los montos viajan como string decimal con la escala canónica de su moneda
spec: platform/api-conventions
related_specs: []
requirement: Montos como string decimal con moneda
scenario: null
requirement_status: confirmed
fr: []
nfr:
- NFR-DATA-001
- NFR-DATA-010
invariants:
- INV-001
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags:
- money
- serialization
- multi-currency
error_code: VALIDATION_FAILED
preconditions:
- W1 con una conversión de 100.000000 USDT a 685.00 BOB
- owner autenticado
input:
- minimumLiquidityReserve:
    amount: '1500'
    currency: BOB
- request: GET de la conversión
- minimumLiquidityReserve:
    amount: 75.5
    currency: BOB
steps:
- PATCH del workspace con la reserva "1500"
- GET de la conversión
- PATCH con amount numérico
expected_result:
- 'Reserva devuelta como {"amount": "1500.00", "currency": "BOB"}'
- Conversión con "100.000000" USDT y "685.00" BOB, ambos strings
- 'amount numérico: 400 VALIDATION_FAILED y no se persiste nada'
- Ningún monto de ninguna respuesta validada contra el contrato es number JSON
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-017 — Los montos viajan como string decimal con la escala canónica de su moneda

## Intención

El punto flotante corrompe montos; la escala canónica evita ambigüedad (INV-001, ARCHITECTURE §4.7).

## Escenario

```gherkin
Cuando la API devuelve una conversión de 100.000000 USDT a 685.00 BOB
Entonces los montos aparecen como "100.000000" y "685.00", ambos strings
```

## Notas

- La conversión requiere add-manual-conversions; el resto se ejecuta con identity.
