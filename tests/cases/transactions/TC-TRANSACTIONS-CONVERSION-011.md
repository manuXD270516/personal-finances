---
id: TC-TRANSACTIONS-CONVERSION-011
title: "Postear una conversión publica un único ConversionRecorded válido y su reentrega es idempotente"
spec: transactions/conversions
related_specs: ["fx/conversion-pricing"]
requirement: "Notificación de la conversión registrada"
scenario: "Publicación única con el detalle"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-022"]
nfr: ["NFR-REL-007","NFR-REL-008"]
invariants: ["INV-028","INV-027"]
priority: high
type: integration
level: event-contract
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/conversions.service.test.ts
  - apps/api/test/api/fx-conversions.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["conversion","outbox","events"]
error_code: null
preconditions:
  - "Outbox y relay activos"
  - "Consumidor de prueba con inbox (consumer, event_id)"
input: {"conversion":"canónica USDT→BOB","schema":"contracts/events/transactions/ConversionRecorded.v1.schema.json","redeliveries":2}
steps:
  - "Postear la conversión canónica"
  - "Leer las filas del outbox de la transacción"
  - "Validar el payload contra el JSON Schema"
  - "Entregar el evento dos veces al consumidor de prueba"
expected_result:
  - "Exactamente un transactions.ConversionRecorded v1 por la revisión posteada"
  - "Payload válido: source 100.000000 USDT, target 685.00 BOB, quotedRate 6.90, effectiveRate 6.85, referenceRate 6.95, fee PROVIDER 5.00 BOB, spread 0.719424460431654676"
  - "El consumidor aplica su efecto una sola vez"
created: 2026-10-02
updated: 2026-10-03
---

# TC-TRANSACTIONS-CONVERSION-011 — Postear una conversión publica un único ConversionRecorded válido y su reentrega es idempotente

## Intención

Reporting y FX dependen del hecho; duplicarlo o perderlo distorsiona historiales (at-least-once + inbox).

## Escenario

```gherkin
Cuando posteo la conversión canónica
Entonces se publica un único hecho "conversión registrada" con su detalle
Cuando el hecho se entrega dos veces
Entonces el consumidor lo aplica una sola vez
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
