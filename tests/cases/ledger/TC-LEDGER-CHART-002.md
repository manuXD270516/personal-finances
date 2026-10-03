---
id: TC-LEDGER-CHART-002
title: Cada cuenta del usuario obtiene una única cuenta contable en su moneda, incluso en concurrencia
spec: ledger/journal-posting
related_specs: [accounts/account-management]
requirement: Cuenta contable respaldada por cada cuenta del usuario
scenario: Obtención repetida de la cuenta contable
requirement_status: confirmed
fr: [FR-ACCOUNTS-003, FR-LEDGER-003]
nfr: []
invariants: [INV-006]
priority: critical
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/ledger/src/application/ledger.service.test.ts
  - packages/contexts/ledger/test/integration/pg-ledger.int.test.ts
status: automated
regression_suite: true
phase: 1
tags: [ledger, chart-of-accounts, concurrency]
error_code: null
preconditions:
- PostgreSQL vía Testcontainers, workspace W1
- 'Cuentas del usuario: Binance USDT (crypto_wallet, USDT), Visa BOB (credit_card, BOB)'
input:
  concurrent_calls: 10
  accounts:
  - Binance USDT
  - Visa BOB
steps:
- Lanzar 10 llamadas concurrentes a getOrCreateForUserAccount(Binance USDT)
- Obtener la cuenta contable de Visa BOB
expected_result:
- Las 10 llamadas devuelven el mismo ledgerAccountId
- Existe exactamente una cuenta contable ASSET en USDT para Binance USDT
- La cuenta contable de Visa BOB es LIABILITY en BOB
created: &id001 2026-10-02
updated: 2026-10-03
---

# TC-LEDGER-CHART-002 — Cada cuenta del usuario obtiene una única cuenta contable en su moneda, incluso en concurrencia

## Intención

FR-ACCOUNTS-003 exige exactamente una cuenta contable por cuenta del usuario; la creación ocurre al crear la cuenta y como red de seguridad en el primer posting, por lo que debe ser idempotente.

## Escenario

```gherkin
Dado la cuenta del usuario "Binance USDT" en USDT
Cuando se solicita su cuenta contable diez veces de forma concurrente
Entonces todas las solicitudes devuelven la misma cuenta contable ASSET en USDT
```

## Notas

- Complementa TC-ACCOUNTS-LEDGERLINK-001 (perspectiva de Accounts).
