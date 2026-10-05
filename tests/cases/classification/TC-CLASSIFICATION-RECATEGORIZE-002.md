---
id: TC-CLASSIFICATION-RECATEGORIZE-002
title: Recategorizar una transacción de un periodo cerrado se rechaza con PERIOD_CLOSED
spec: classification/categories
related_specs: [transactions/splits, ledger/journal-posting]
requirement: Recategorizar no modifica el ledger
scenario: Recategorizar en un periodo cerrado
requirement_status: confirmed
fr: [FR-LEDGER-008, FR-TRANSACTIONS-008]
nfr: []
invariants: [INV-015, INV-033]
priority: high
type: integration
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/classification-ledger.api.test.ts
  - packages/contexts/transactions/src/application/transactions.service.test.ts
  - packages/contexts/ledger/src/application/ledger.service.test.ts
status: automated
regression_suite: false
phase: 1
tags: [classification, ledger, period-lock]
error_code: PERIOD_CLOSED
preconditions:
- Gasto contabilizado T1 de 150.00 BOB del 2026-03-15 desde "Banco BOB", categoría "Supermercado"
- El periodo 2026-03 está cerrado (bloqueo de periodo del ledger)
input:
  transaction: T1
  from: Supermercado
  to: Hogar
steps:
- Leer la categoría de la porción, los totales de marzo por categoría, la auditoría y el outbox de T1
- Intentar recategorizar T1 a "Hogar"
- Volver a leer lo mismo
expected_result:
- La operación se rechaza con 409 y code PERIOD_CLOSED
- La porción sigue en "Supermercado" y la versión de T1 no cambia
- Los totales de marzo por categoría no cambian
- No se escribe auditoría ni se publica transactions.TransactionCategorized.v1
created: 2026-10-05
updated: 2026-10-05
---

# TC-CLASSIFICATION-RECATEGORIZE-002 — Recategorizar en un periodo cerrado se rechaza con PERIOD_CLOSED

## Intención

Decisión del owner D49 (docs/31, 2026-10-05): un periodo cerrado no cambia silenciosamente (INV-015), tampoco en su clasificación; recategorizar una transacción de un periodo cerrado se rechaza con `PERIOD_CLOSED` (semántica de `PF004`).

## Escenario

```gherkin
Dado un gasto contabilizado de 150.00 BOB del 2026-03-15 categorizado como "Supermercado"
  Y el periodo de marzo de 2026 está cerrado
Cuando el usuario intenta cambiar su categoría a "Hogar"
Entonces se rechaza con el código "PERIOD_CLOSED"
  Y la porción sigue en "Supermercado"
  Y los totales de marzo por categoría no cambian
```

## Notas

- Lo automatiza add-classification junto con la validación del bloqueo de periodo en la recategorización.
- Automatizado 2026-10-05 (docs/31 D49): antes del cambio el PATCH respondía 200 (recategorizar no genera asiento y el ledger no veía el periodo cerrado). Transactions consulta `LedgerPostingPort.assertPeriodOpen` (nuevo, sin efectos) cuando cambia la categoría de algún split; por HTTP: 409 `PERIOD_CLOSED`, la porción sigue en "Supermercado" con la misma versión, totales de marzo, asientos/postings, saldo, auditoría y outbox sin cambios.
