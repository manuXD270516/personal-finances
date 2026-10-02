---
id: TC-LEDGER-CHART-001
title: La naturaleza y la moneda de una cuenta contable no pueden cambiar
spec: ledger/journal-posting
related_specs: []
requirement: Cuenta contable con naturaleza y moneda únicas e inmutables
scenario: Intento de cambiar la moneda de una cuenta contable
requirement_status: confirmed
fr: [FR-LEDGER-003]
nfr: []
invariants: [INV-006]
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: [ledger, chart-of-accounts]
error_code: null
preconditions:
- PostgreSQL vía Testcontainers, rol pf_app, workspace W1
- 'Cuenta contable de Bank A: ASSET, BOB, con un posting de +1000.00 BOB'
input:
  statements:
  - UPDATE ledger.ledger_account SET currency = 'USD' WHERE id = <Bank A>
  - UPDATE ledger.ledger_account SET type = 'LIABILITY' WHERE id = <Bank A>
steps:
- Verificar que el AR LedgerAccount no expone operaciones para cambiar naturaleza ni moneda (test de dominio)
- Ejecutar cada sentencia como pf_app
expected_result:
- El dominio no ofrece la operación
- Cada sentencia falla por privilegio no otorgado (solo archived_at es actualizable)
- La cuenta contable sigue en BOB con naturaleza ASSET
created: &id001 2026-10-02
updated: *id001
---

# TC-LEDGER-CHART-001 — La naturaleza y la moneda de una cuenta contable no pueden cambiar

## Intención

Si la moneda o naturaleza de una cuenta contable cambiara, todos sus postings históricos quedarían inconsistentes (INV-006).

## Escenario

```gherkin
Dado la cuenta contable de "Bank A" en BOB con naturaleza ASSET
Cuando se intenta cambiar su moneda a USD
Entonces la operación se rechaza
  Y la cuenta sigue en BOB con naturaleza ASSET
```
