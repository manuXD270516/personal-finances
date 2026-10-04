---
id: TC-TRANSACTIONS-IDEMPOTENCY-001
title: Repetir un POST con el mismo Idempotency-Key devuelve el resultado original sin duplicar
spec: platform/api-conventions
related_specs:
- transactions/transaction-recording
requirement: Reproducción idempotente de POST financieros
scenario: Reintento de un gasto ya registrado
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
automation_status: automated
automated_tests:
  - apps/api/test/api/api-conventions.api.test.ts
  - packages/platform/src/api/idempotency/policy.test.ts
  - apps/web/src/bff/finance-api-client.test.ts
  - apps/api/test/api/transactions.api.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- idempotency
- api
error_code: null
preconditions:
- finance-api bajo prueba (Nest + supertest) con PostgreSQL mediante Testcontainers
- EDITOR autenticado de W1
- Cuenta Bank A de W1 con saldo 1000.00 BOB
input:
  endpoint: POST /api/v1/workspaces/{W1}/transactions
  idempotency_key: 0191f0c2-7a1e-7c4e-9a51-3f2d7c1b9e01
  body:
    accountId: Bank A
    amount:
      amount: '75.00'
      currency: BOB
    date: '2026-03-15'
    category: Transport
steps:
- Enviar la solicitud
- Enviar la solicitud idéntica con la misma clave
- Contar transacciones, asientos, filas de auditoría y eventos de outbox
- Consultar el saldo de Bank A
expected_result:
- 'Primera: 201 con id de transacción X, Location y ETag'
- 'Repetición: mismo estado, cuerpo (id X), Location y ETag, con Idempotent-Replayed: true'
- Existe una sola transacción, un solo asiento, una sola fila de auditoría y un solo evento para el gasto
- 'Saldo de Bank A: 925.00 BOB'
created: 2026-10-01
updated: 2026-10-04
---

# TC-TRANSACTIONS-IDEMPOTENCY-001 — Repetir un POST con el mismo Idempotency-Key devuelve el resultado original sin duplicar

## Intención

Los reintentos de red desde el BFF nunca deben registrar dinero dos veces (ARCHITECTURE §8, INV-027).

## Escenario

```gherkin
Dada una solicitud para crear un gasto de 75.00 BOB con Idempotency-Key "K"
Cuando la misma solicitud se envía dos veces
Entonces ambas respuestas contienen el mismo id de transacción
  Y solo existe una transacción
  Y el saldo de "Bank A" baja una sola vez a 925.00 BOB
```

## Notas

- Clave ausente (428), payload distinto (422) y concurrencia (409) se movieron a TC-PLATFORM-API-007, 008 y 009.
- Mientras add-transaction-recording no exista, la mecánica se verifica con POST /api/v1/workspaces y un controller de prueba del harness.
