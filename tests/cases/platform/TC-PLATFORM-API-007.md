---
id: TC-PLATFORM-API-007
title: Un POST financiero sin Idempotency-Key se rechaza con 428 sin efectos
spec: platform/api-conventions
related_specs:
- transactions/transaction-recording
requirement: Idempotency-Key obligatoria en POST financieros
scenario: POST financiero sin clave
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
error_code: IDEMPOTENCY_KEY_REQUIRED
preconditions:
- EDITOR de W1; controller de prueba financiero o POST de transacciones
input:
- Idempotency-Key: null
  body:
    amount:
      amount: '75.00'
      currency: BOB
- Idempotency-Key: abc
  body:
    amount:
      amount: '75.00'
      currency: BOB
steps:
- Enviar cada solicitud
- Contar transacciones, asientos, auditoría y outbox
expected_result:
- 'Sin clave: 428 IDEMPOTENCY_KEY_REQUIRED'
- 'Clave ''abc'': 400 VALIDATION_FAILED'
- Ningún efecto persistido
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-007 — Un POST financiero sin Idempotency-Key se rechaza con 428 sin efectos

## Intención

Sin clave no hay forma de deduplicar reintentos de un registro de dinero (docs/10 §7).

## Escenario

```gherkin
Cuando un EDITOR registra un gasto de 75.00 BOB sin "Idempotency-Key"
Entonces la respuesta es 428 con código "IDEMPOTENCY_KEY_REQUIRED"
  Y no se crea ninguna transacción
```
