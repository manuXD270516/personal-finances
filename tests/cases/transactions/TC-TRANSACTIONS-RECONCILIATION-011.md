---
id: TC-TRANSACTIONS-RECONCILIATION-011
title: "Cada cambio cleared publica una vez el evento TransactionCleared"
spec: transactions/reconciliation
related_specs: ["platform/event-delivery"]
requirement: "Evento dedicado de transacción confirmada"
scenario: "Confirmar un gasto publica el hecho dedicado"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-029, FR-TRANSACTIONS-030]
nfr: []
invariants: [INV-028]
priority: high
type: integration
level: event-contract
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["events", "cleared"]
error_code: null
preconditions:
  - "Gasto posted de 150.00 BOB en \"Bank A\""
input:
  - "{\"action\":\"mark-cleared\",\"cleared\":true}"
  - "{\"action\":\"redelivery\"}"
steps:
  - "Marcar cleared"
  - "Leer el outbox"
  - "Entregar dos veces el evento a un consumidor de prueba"
expected_result:
  - "Un transactions.TransactionCleared.v1 (cleared true, previousStatus POSTED) y un TransactionUpdated.v1 (changedFields [status])"
  - "El payload valida contra contracts/events/transactions/TransactionCleared.v1.schema.json"
  - "El consumidor aplica el efecto una sola vez (inbox)"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-011 — Cada cambio cleared publica una vez el evento TransactionCleared

## Intención

Decisión D47: el evento dedicado llega en Phase 2 sin romper a los consumidores de TransactionUpdated.

## Escenario

```gherkin
Dado un gasto posted de 150.00 BOB
Cuando el usuario lo marca como cleared
Entonces se publica un único "TransactionCleared" con confirmación verdadera
  Y un "TransactionUpdated" con el campo de estado cambiado
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
