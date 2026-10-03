---
id: TC-PLATFORM-API-010
title: Un 503 no consume la clave y un rechazo de dominio se reproduce
spec: platform/api-conventions
related_specs: []
requirement: Errores transitorios no consumen la clave de idempotencia
scenario: null
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-007
- NFR-REL-010
invariants:
- INV-027
priority: critical
type: integration
level: api
automation_status: automated
automated_tests:
- apps/api/test/api/api-conventions.api.test.ts
- packages/platform/src/api/idempotency/policy.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- idempotency
- resilience
error_code: null
preconditions:
- finance-api con PostgreSQL (Testcontainers) e inyección de fallo de base de datos
- EDITOR de W1
input:
- Idempotency-Key: K-0002-0002-0002
  amount:
    amount: '75.00'
    currency: BOB
  fallo: 503 en el primer intento
- Idempotency-Key: K-0003-0003-0003
  amount:
    amount: '685.005'
    currency: BOB
steps:
- Enviar el gasto de 75.00 BOB con el fallo inyectado y reintentar sin fallo
- Enviar dos veces el gasto de 685.005 BOB
expected_result:
- '75.00 BOB: primer intento 503 SERVICE_UNAVAILABLE; reintento 201 sin Idempotent-Replayed; existe exactamente una transacción'
- '685.005 BOB: ambos 422 AMOUNT_SCALE_EXCEEDED; el segundo con Idempotent-Replayed: true'
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-010 — Un 503 no consume la clave y un rechazo de dominio se reproduce

## Intención

Un fallo transitorio no debe bloquear al usuario con una respuesta de error cacheada (docs/10 §7.7).

## Escenario

```gherkin
Dado un gasto de 75.00 BOB que falló con 503
Cuando se reintenta con la misma clave
Entonces se registra una sola vez con 201
```
