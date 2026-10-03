---
id: TC-PLATFORM-API-009
title: Dos peticiones simultáneas con la misma clave producen un solo efecto
spec: platform/api-conventions
related_specs: []
requirement: Peticiones idempotentes concurrentes
scenario: Doble clic que envía dos peticiones simultáneas
requirement_status: confirmed
fr:
- FR-TRANSACTIONS-010
nfr:
- NFR-REL-007
invariants:
- INV-027
priority: critical
type: integration
level: api
automation_status: automated
automated_tests:
- apps/api/test/api/api-conventions.api.test.ts
- apps/api/test/db/idempotency-key.int.test.ts
- packages/platform/src/api/idempotency/policy.test.ts
- apps/web/src/bff/finance-api-client.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- idempotency
- concurrency
error_code: IDEMPOTENCY_REQUEST_IN_PROGRESS
preconditions:
- finance-api con PostgreSQL (Testcontainers); el comando se ralentiza 500 ms con un fake del reloj/puerto
- EDITOR de W1
input:
  Idempotency-Key: K-0009-0009-0009
  amount:
    amount: '75.00'
    currency: BOB
  concurrentes: 2
steps:
- Enviar las dos peticiones idénticas a la vez
- Contar transacciones de 75.00 BOB
expected_result:
- 'Una respuesta 201; la otra 201 con Idempotent-Replayed: true o 409 IDEMPOTENCY_REQUEST_IN_PROGRESS con Retry-After'
- Existe exactamente una transacción de 75.00 BOB
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-009 — Dos peticiones simultáneas con la misma clave producen un solo efecto

## Intención

El doble clic y los reintentos agresivos son el caso real de duplicación de dinero (INV-027).

## Escenario

```gherkin
Dadas dos peticiones idénticas de un gasto de 75.00 BOB con la misma clave nueva
Cuando se envían simultáneamente
Entonces existe exactamente una transacción de 75.00 BOB
```

## Notas

- Incluye la variante de reserva IN_PROGRESS vencida (proceso caído) que se retoma.
