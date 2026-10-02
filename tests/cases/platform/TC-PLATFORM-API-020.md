---
id: TC-PLATFORM-API-020
title: Exceder el límite de escrituras responde 429 con Retry-After sin efectos
spec: platform/api-conventions
related_specs: []
requirement: Límite de tasa por usuario
scenario: Ráfaga de escrituras
requirement_status: confirmed
fr: []
nfr:
- NFR-SEC-011
invariants: []
priority: low
type: api
level: api
automation_status: automated
automated_tests:
- apps/api/test/api/api-conventions.api.test.ts
- packages/platform/src/api/rate-limit/rate-limiter.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- rate-limit
error_code: RATE_LIMITED
preconditions:
- RATE_LIMIT_WRITES_PER_MIN=120, reloj fijo; EDITOR de W1
input:
  escrituras: 121
  ventana: 60 s
  amount:
    amount: '1.00'
    currency: BOB
steps:
- Enviar 121 escrituras con claves de idempotencia distintas
- Contar efectos
expected_result:
- 'Las 120 primeras: 2xx con cabeceras RateLimit y RateLimit-Policy'
- 'La 121: 429 RATE_LIMITED con Retry-After'
- Existen 120 registros, no 121
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-020 — Exceder el límite de escrituras responde 429 con Retry-After sin efectos

## Intención

Limita abuso y errores de cliente en bucle (NFR-SEC-011).

## Escenario

```gherkin
Dado un límite de 120 escrituras por minuto
Cuando un usuario envía 121 escrituras en menos de un minuto
Entonces la petición 121 responde 429 con código "RATE_LIMITED"
```

## Notas

- Requirement Should.
