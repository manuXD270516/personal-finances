---
id: TC-PLATFORM-API-018
title: Un monto con más decimales que su moneda se rechaza sin redondear
spec: platform/api-conventions
related_specs: []
requirement: Rechazo de montos con escala excesiva
scenario: null
requirement_status: confirmed
fr: []
nfr:
- NFR-DATA-001
- NFR-DATA-002
invariants:
- INV-001
- INV-020
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
- rounding
- multi-currency
error_code: AMOUNT_SCALE_EXCEEDED
preconditions:
- EDITOR de W1; monedas BOB (escala 2) y USDT (escala 6)
input:
- amount:
    amount: '100.0000001'
    currency: USDT
- amount:
    amount: '685.005'
    currency: BOB
steps:
- Enviar cada monto en una operación que acepta dinero
- Buscar montos persistidos
expected_result:
- 'Ambos: 422 AMOUNT_SCALE_EXCEEDED'
- No se persiste 685.00 BOB, 685.01 BOB ni 100.000000 USDT
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-018 — Un monto con más decimales que su moneda se rechaza sin redondear

## Intención

Redondear en silencio cambiaría el dinero registrado (INV-020).

## Escenario

```gherkin
Cuando un cliente envía un monto de 685.005 BOB
Entonces la respuesta es 422 con código "AMOUNT_SCALE_EXCEEDED"
  Y no se persiste un monto redondeado
```
