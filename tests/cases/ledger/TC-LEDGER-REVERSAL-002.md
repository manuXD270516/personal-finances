---
id: TC-LEDGER-REVERSAL-002
title: Un asiento solo puede revertirse una vez y una reversa no puede revertirse
spec: ledger/journal-posting
related_specs: []
requirement: Un asiento se revierte a lo sumo una vez
scenario: Reversas concurrentes
requirement_status: confirmed
fr: [FR-LEDGER-005]
nfr: []
invariants: [INV-008]
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/ledger/src/application/ledger.service.test.ts
  - packages/contexts/ledger/src/domain/reversal-factory.test.ts
  - packages/contexts/ledger/test/integration/pg-ledger.int.test.ts
status: automated
regression_suite: true
phase: 1
tags: [reversal, concurrency]
error_code: LEDGER_ENTRY_ALREADY_REVERSED
preconditions:
- PostgreSQL vía Testcontainers, rol pf_app, workspace W1
- Bank A (BOB) con saldo 1000.00 BOB
- 'E1: EXPENSE:BOB +120.00 (s1) / Bank A -120.00, ya revertido por R1'
- 'E2: EXPENSE:BOB +45.00 (s2) / Bank A -45.00, sin revertir'
input:
- reverse: E1
- reverse: E2
  concurrent: 2
- reverse: R1
steps:
- Revertir E1
- Lanzar dos reversas concurrentes de E2
- Revertir R1
expected_result:
- Revertir E1 se rechaza con LEDGER_ENTRY_ALREADY_REVERSED
- De las dos reversas de E2 exactamente una se registra; la otra falla con LEDGER_ENTRY_ALREADY_REVERSED
- Revertir R1 se rechaza con LEDGER_ENTRY_NOT_REVERSIBLE
- Saldo final de Bank A = 1000.00 BOB
created: &id001 2026-10-02
updated: 2026-10-03
---

# TC-LEDGER-REVERSAL-002 — Un asiento solo puede revertirse una vez y una reversa no puede revertirse

## Intención

INV-008: una doble reversa devolvería dinero inexistente; la PK de entry_reversal lo impide también bajo concurrencia.

## Escenario

```gherkin
Dado que "E1" ya fue revertido por "R1"
Cuando se solicita revertir "E1" otra vez
Entonces se rechaza con el código "LEDGER_ENTRY_ALREADY_REVERSED"
Cuando se solicita revertir "R1"
Entonces se rechaza con el código "LEDGER_ENTRY_NOT_REVERSIBLE"
```
