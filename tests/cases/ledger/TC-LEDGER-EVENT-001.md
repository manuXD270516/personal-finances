---
id: TC-LEDGER-EVENT-001
title: Cada asiento registrado publica JournalEntryPosted válido en la misma transacción
spec: ledger/journal-posting
related_specs: []
requirement: Publicación del evento de asiento registrado
scenario: Evento de una conversión
requirement_status: confirmed
fr: [FR-LEDGER-001]
nfr: [NFR-REL-008]
invariants: [INV-001, INV-004]
priority: critical
type: integration
level: event-contract
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [events, outbox, contract]
error_code: null
preconditions:
- PostgreSQL vía Testcontainers con platform.outbox
- Schemas de contracts/events precargados en el validador
input:
  entry:
  - Binance USDT -100.000000 USDT
  - EQUITY:FX_TRADING:USDT +100.000000 USDT
  - EQUITY:FX_TRADING:BOB -690.00 BOB
  - Bank A +685.00 BOB
  - EXPENSE:BOB +5.00 BOB (s1)
  rejected_entry:
  - +50.00 BOB
  - -49.00 BOB
steps:
- Registrar la conversión y leer el outbox
- Registrar el asiento desbalanceado
- Revertir la conversión
expected_result:
- Hay exactamente un evento ledger.JournalEntryPosted v1 para la conversión, válido contra JournalEntryPosted.v1.schema.json
- Los montos son strings a la escala de su moneda ("-100.000000" USDT, "685.00" BOB) y suman 0 por moneda
- El asiento rechazado no deja evento en el outbox (rollback conjunto)
- La reversa publica su propio evento con entryType REVERSAL y reversesEntryId de la conversión
created: &id001 2026-10-02
updated: *id001
---

# TC-LEDGER-EVENT-001 — Cada asiento registrado publica JournalEntryPosted válido en la misma transacción

## Intención

Reporting y Goals proyectan saldos desde este evento; un evento perdido o con montos float desincronizaría los read models.

## Escenario

```gherkin
Dado la conversión de 100.000000 USDT a 685.00 BOB con fee de 5.00 BOB
Cuando se registra su asiento
Entonces se publica un único evento "ledger.JournalEntryPosted" con cinco postings
  Y la suma por moneda de sus montos es cero
```
