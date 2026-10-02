---
id: TC-IDENTITY-WORKSPACE-005
title: La reserva mínima de liquidez respeta la escala de su moneda
spec: identity/workspace-membership
related_specs: []
requirement: Reserva mínima de liquidez del workspace
scenario: null
requirement_status: confirmed
fr:
- FR-IDENTITY-005
nfr:
- NFR-DATA-001
invariants:
- INV-001
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags:
- workspace
- money
error_code: AMOUNT_SCALE_EXCEEDED
preconditions:
- W1 Personal Demo sin reserva mínima, owner autenticado
input:
- minimumLiquidityReserve:
    amount: '1500.00'
    currency: BOB
- minimumLiquidityReserve:
    amount: '1500.005'
    currency: BOB
- minimumLiquidityReserve: null
steps:
- PATCH /api/v1/workspaces/{W1} con cada cuerpo (If-Match vigente)
- GET /api/v1/workspaces/{W1}
expected_result:
- '1500.00 BOB: 200 con minimumLiquidityReserve {"amount": "1500.00", "currency": "BOB"}'
- '1500.005 BOB: 422 AMOUNT_SCALE_EXCEEDED y la reserva sigue en 1500.00 BOB'
- 'null: 200 y el workspace queda sin reserva'
created: 2026-10-02
updated: 2026-10-02
---

# TC-IDENTITY-WORKSPACE-005 — La reserva mínima de liquidez respeta la escala de su moneda

## Intención

La reserva alimenta safe-to-spend; un redondeo silencioso cambiaría el dinero disponible mostrado.

## Escenario

```gherkin
Dado el OWNER de "W1 Personal Demo"
Cuando define la reserva mínima en 1500.00 BOB
Entonces el workspace devuelve 1500.00 BOB
Cuando define la reserva en 1500.005 BOB
Entonces la respuesta es 422 con código "AMOUNT_SCALE_EXCEEDED"
```
