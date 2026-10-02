---
id: TC-PLATFORM-API-008
title: Reutilizar un Idempotency-Key con otro payload se rechaza con 422
spec: platform/api-conventions
related_specs:
- transactions/transaction-recording
requirement: Rechazo de Idempotency-Key reutilizada con otro payload
scenario: Misma clave, monto distinto
requirement_status: confirmed
fr:
- FR-TRANSACTIONS-010
nfr:
- NFR-REL-007
invariants:
- INV-027
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags:
- idempotency
error_code: IDEMPOTENCY_KEY_REUSED
preconditions:
- EDITOR de W1
input:
- Idempotency-Key: K-0001-0001-0001
  amount:
    amount: '75.00'
    currency: BOB
- Idempotency-Key: K-0001-0001-0001
  amount:
    amount: '80.00'
    currency: BOB
steps:
- Enviar ambas solicitudes en orden
- Listar transacciones
expected_result:
- 'Primera: 201'
- 'Segunda: 422 problem+json con código IDEMPOTENCY_KEY_REUSED'
- Solo existe el gasto de 75.00 BOB
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-008 — Reutilizar un Idempotency-Key con otro payload se rechaza con 422

## Intención

Una clave reutilizada con datos distintos indica un bug del cliente; nunca debe registrar el segundo monto ni devolver el primero como si fuera el segundo.

## Escenario

```gherkin
Dado un gasto de 75.00 BOB registrado con la clave "K-0001-0001-0001"
Cuando se envía un gasto de 80.00 BOB con la misma clave
Entonces la respuesta es 422 con código "IDEMPOTENCY_KEY_REUSED"
  Y solo existe el gasto de 75.00 BOB
```

## Notas

- Estado 422 según docs/10 §7 y el contrato; INV-027 (docs/09) dice 409: contradicción reportada en el change add-api-conventions.
