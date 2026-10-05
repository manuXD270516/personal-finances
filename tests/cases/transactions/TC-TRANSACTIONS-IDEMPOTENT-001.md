---
id: TC-TRANSACTIONS-IDEMPOTENT-001
title: Reenviar la creación con la misma Idempotency-Key devuelve el mismo resultado y con payload distinto se rechaza con 422
spec: transactions/transaction-recording
related_specs:
- platform/api-conventions
- ledger/journal-posting
requirement: Creación idempotente de transacciones
scenario: Reintento de red al registrar un gasto
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
  - apps/api/test/api/transactions.api.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- idempotency
- api
- regression
error_code: IDEMPOTENCY_KEY_REUSED
preconditions:
- finance-api bajo prueba con PostgreSQL mediante Testcontainers
- EDITOR autenticado de W1
- Cuenta Bank A (ASSET, BOB) de W1 con saldo 1000.00 BOB
- Categoría Transport activa
input:
  endpoint: POST /api/v1/workspaces/{W1}/transactions
  idempotency_key: 0191f0c2-7a1e-7c4e-9a51-3f2d7c1b9e10
  body:
    kind: EXPENSE
    accountId: Bank A
    amount:
      amount: '75.00'
      currency: BOB
    date: '2026-03-15'
    category: Transport
  body_distinto:
    kind: EXPENSE
    accountId: Bank A
    amount:
      amount: '80.00'
      currency: BOB
    date: '2026-03-15'
    category: Transport
steps:
- Enviar la creación del gasto con la clave K
- Reenviar la solicitud idéntica con la misma clave K
- Contar transacciones y asientos del workspace y leer el saldo de Bank A
- Enviar con la misma clave K un payload distinto (monto 80.00 BOB)
- Volver a contar transacciones y asientos y leer el saldo
expected_result:
- 'Primera solicitud: 201 con id de transacción X'
- 'Reenvío idéntico: misma respuesta (estado y cuerpo con id X) sin crear nada nuevo'
- Existe una sola transacción y un solo asiento (EXPENSE:BOB +75.00 en Transport; Bank A -75.00; suma 0.00 BOB)
- 'Saldo de Bank A: 925.00 BOB'
- 'Payload distinto con la misma clave: 422 con code IDEMPOTENCY_KEY_REUSED (RFC 9457)'
- Tras el 422 siguen existiendo una sola transacción y un solo asiento, y el saldo sigue en 925.00 BOB
created: 2026-10-02
updated: 2026-10-05
---

# TC-TRANSACTIONS-IDEMPOTENT-001 — Reenviar la creación con la misma Idempotency-Key devuelve el mismo resultado y con payload distinto se rechaza con 422

## Intención

Un reintento de red nunca debe registrar dinero dos veces, y una clave reutilizada con otro contenido debe rechazarse en lugar de devolver un resultado ajeno (INV-027, docs/31 D1).

## Escenario

```gherkin
Dada una solicitud para crear un gasto de 75.00 BOB en "Bank A" con Idempotency-Key "K"
Cuando el cliente envía dos veces la misma solicitud con la clave "K"
Entonces ambas respuestas contienen el mismo identificador de transacción
  Y existe una sola transacción y el saldo de "Bank A" baja una sola vez a 925.00 BOB
Cuando el cliente envía con la clave "K" un gasto de 80.00 BOB
Entonces se rechaza con 422 y el código "IDEMPOTENCY_KEY_REUSED"
  Y no se crea ninguna transacción ni asiento adicional
```

## Notas

- Código de rechazo según docs/31 D1 (422, no 409).
- La mecánica transversal de la cabecera la cubren TC-TRANSACTIONS-IDEMPOTENCY-001 y TC-PLATFORM-API-007/008/009 (add-api-conventions); este TC verifica el requirement de transaction-recording.
- Datos de la Minimal Seed (docs/29).
