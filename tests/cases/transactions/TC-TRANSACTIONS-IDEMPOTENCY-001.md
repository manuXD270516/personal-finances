---
id: TC-TRANSACTIONS-IDEMPOTENCY-001
title: "Repetir un POST con el mismo Idempotency-Key devuelve el resultado original sin duplicar"
spec: transactions/transaction-recording
related_specs: ["platform/api-conventions"]
requirement: "Creación idempotente de transacciones"
scenario: null
requirement_status: provisional
fr: [FR-TRANSACTIONS-009]
nfr: [NFR-REL-001]
invariants: []
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["idempotency", "api"]
error_code: "IDEMPOTENCY_KEY_REUSED"
preconditions:
  - "finance-api bajo prueba (Nest + supertest) con PostgreSQL y Valkey mediante Testcontainers"
  - "EDITOR autenticado de W1"
input:
  endpoint: "POST /api/v1/workspaces/{W1}/transactions"
  idempotency_key: "0191f0c2-7a1e-7c4e-9a51-3f2d7c1b9e01"
  body:
    accountId: "Bank A"
    amount:
      amount: "75.00"
      currency: "BOB"
    date: "2026-03-15"
    category: "Transport"
steps:
  - "Enviar la solicitud"
  - "Enviar la solicitud idéntica con la misma clave"
  - "Enviar un cuerpo diferente con la misma clave"
  - "Enviar dos solicitudes idénticas de forma concurrente con una clave nueva"
  - "Enviar una solicitud sin Idempotency-Key"
expected_result:
  - "Primera: 201 con id de transacción X"
  - "Repetición: mismo estado y cuerpo (id X); no se crea una nueva transacción, asiento, fila de auditoría ni evento de outbox"
  - "Cuerpo diferente: 422 problem+json con código IDEMPOTENCY_KEY_REUSED"
  - "Concurrentes: se crea exactamente una transacción; ambas respuestas llevan el mismo id"
  - "Clave ausente: 400 problem+json con código IDEMPOTENCY_KEY_REQUIRED"
created: 2026-10-01
updated: 2026-10-01
---

# TC-TRANSACTIONS-IDEMPOTENCY-001 — Repetir un POST con el mismo Idempotency-Key devuelve el resultado original sin duplicar

## Intención

Los reintentos de red desde el BFF o los clientes móviles nunca deben registrar dinero dos veces (ARCHITECTURE §8).

## Escenario

```gherkin
Dada una solicitud para crear un gasto con Idempotency-Key "K"
Cuando la misma solicitud se envía dos veces
Entonces ambas respuestas contienen el mismo id de transacción
  Y solo existe una transacción
```
