---
id: TC-TRANSACTIONS-CONVERSION-012
title: "Corregir una conversión publica un único ConversionRevised y no re-emite ConversionRecorded"
spec: transactions/conversions
related_specs: ["audit/lifecycle-timeline"]
requirement: "Notificación de la conversión registrada"
scenario: "Corrección publica una revisión"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-022", "FR-TRANSACTIONS-024"]
nfr: ["NFR-REL-007", "NFR-REL-008"]
invariants: ["INV-028", "INV-027"]
priority: high
type: integration
level: event-contract
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/conversions.service.test.ts
  - packages/contexts/transactions/src/domain/transaction-lifecycle.test.ts
  - apps/api/test/api/fx-conversions.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["conversion","outbox","events","lifecycle"]
error_code: null
preconditions:
  - "Outbox y relay activos"
  - "Consumidor de prueba con inbox (consumer, event_id)"
  - "Conversión canónica USDT→BOB posteada (100.000000 USDT → 685.00 BOB, fee PROVIDER 5.00 BOB), revisión 1"
input: {"correction":"685.00 → 686.00 BOB recibidos, fee 4.00 BOB","schema":"contracts/events/transactions/ConversionRevised.v1.schema.json","redeliveries":2}
steps:
  - "Corregir la conversión"
  - "Leer las filas del outbox de la transacción"
  - "Validar el payload contra el JSON Schema"
  - "Entregar el evento dos veces al consumidor de prueba"
expected_result:
  - "Exactamente un transactions.ConversionRevised v1 con revisión 1 → 2, asiento revertido, asiento de reversa y asiento nuevo"
  - "Payload válido: source 100.000000 USDT, target 686.00 BOB, effectiveRate 6.86"
  - "No se publica un segundo transactions.ConversionRecorded (solo existe el del primer posteo)"
  - "El consumidor aplica su efecto una sola vez"
created: 2026-10-05
updated: 2026-10-05
---

# TC-TRANSACTIONS-CONVERSION-012 — Corregir una conversión publica un único ConversionRevised

## Intención

Decisión del owner D48 (docs/31, 2026-10-05): simetría con `TransferRevised.v1` (D37). `ConversionRecorded.v1` se publica una sola vez (primer posteo) y cada edición financiera publica `ConversionRevised.v1`.

## Escenario

```gherkin
Dado la conversión canónica de 100.000000 USDT a 685.00 BOB posteada
Cuando el usuario corrige el monto recibido a 686.00 BOB con fee 4.00 BOB
Entonces se publica un único ConversionRevised de la revisión 1 a la 2
  Y no se publica otro ConversionRecorded
```

## Notas

- Lo automatiza el change que implemente `ConversionRevised.v1` (add-manual-conversions / add-lifecycle-timeline).
