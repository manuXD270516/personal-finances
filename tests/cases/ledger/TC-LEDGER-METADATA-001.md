---
id: TC-LEDGER-METADATA-001
title: El asiento registra fecha, tipo, origen, actor, correlación, instante y secuencia
spec: ledger/journal-posting
related_specs: []
requirement: Metadatos de trazabilidad del asiento
scenario: Asiento de un gasto registrado
requirement_status: confirmed
fr: [FR-LEDGER-009]
nfr: [NFR-OBS-001]
invariants: []
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/ledger/src/application/ledger.service.test.ts
status: automated
regression_suite: false
phase: 1
tags: [ledger, traceability]
error_code: null
preconditions:
- FixedClock en 2026-03-10T15:00:00Z
- Usuario U1, correlación C1
- Último asiento del workspace con sequence 41
input:
  source:
    context: TRANSACTIONS
    type: Transaction
    id: T1
    revision: 1
  entry_date: '2026-03-10'
  postings:
  - EXPENSE:BOB +45.50 (s1)
  - Bank A -45.50
steps:
- Ejecutar PostJournalEntry
- Leer el asiento persistido y el evento del outbox
expected_result:
- entry_date = 2026-03-10, entry_type = STANDARD, source = T1 revisión 1, actor = U1, correlation_id = C1
- created_at = 2026-03-10T15:00:00Z (UTC)
- sequence > 41
- reverses_entry_id es nulo
- El evento ledger.JournalEntryPosted lleva los mismos metadatos
created: &id001 2026-10-02
updated: 2026-10-03
---

# TC-LEDGER-METADATA-001 — El asiento registra fecha, tipo, origen, actor, correlación, instante y secuencia

## Intención

FR-LEDGER-009: sin estos metadatos no se puede reconstruir quién, cuándo y por qué se registró un asiento.

## Escenario

```gherkin
Dado el usuario "U1" con la correlación "C1"
Cuando registra la transacción "T1" (revisión 1) de 45.50 BOB con fecha 2026-03-10
Entonces el asiento registra fecha 2026-03-10, tipo STANDARD, origen T1 revisión 1, actor U1 y correlación C1
```
