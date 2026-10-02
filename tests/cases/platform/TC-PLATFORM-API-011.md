---
id: TC-PLATFORM-API-011
title: Una clave de idempotencia vencida se trata como nueva
spec: platform/api-conventions
related_specs: []
requirement: Retención limitada de claves de idempotencia
scenario: Clave vencida
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-007
invariants: []
priority: low
type: integration
level: repository-integration
automation_status: automated
automated_tests:
- apps/api/test/api/api-conventions.api.test.ts
- apps/api/test/db/idempotency-key.int.test.ts
- packages/platform/src/api/idempotency/policy.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- idempotency
- retention
error_code: null
preconditions:
- PostgreSQL (Testcontainers), IDEMPOTENCY_RETENTION=24h, reloj controlable
input:
  Idempotency-Key: K-0011-0011-0011
  amount:
    amount: '75.00'
    currency: BOB
  registro: '2026-10-01T10:00:00Z'
  reintento: '2026-10-02T11:00:00Z'
steps:
- Registrar el gasto
- Avanzar el reloj 25 h y ejecutar la purga
- Reenviar con la misma clave
expected_result:
- La clave se purgó
- El reenvío crea una segunda transacción de 75.00 BOB con 201 sin Idempotent-Replayed
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-011 — Una clave de idempotencia vencida se trata como nueva

## Intención

La retención acota el almacenamiento de respuestas con datos financieros (docs/08 §5.18).

## Escenario

```gherkin
Dada una clave usada hace 25 horas con retención de 24 horas
Cuando se reutiliza
Entonces la petición se procesa como nueva
```

## Notas

- Requirement Should.
