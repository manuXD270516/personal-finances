---
id: TC-ACCOUNTS-ARCHIVE-001
title: "Una cuenta archivada desaparece del listado por defecto pero sigue consultable con su saldo"
spec: accounts/account-management
related_specs: ["audit/audit-trail"]
requirement: "Archivar cuenta"
scenario: "Archivar una cuenta"
requirement_status: confirmed
fr: [FR-ACCOUNTS-007]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/accounts/src/domain/account.test.ts
  - apps/api/test/api/accounts.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["accounts", "archive"]
error_code: "INVALID_STATUS_TRANSITION"
preconditions: ["Bank B (savings, BOB) activa con saldo 0.00 BOB"]
input:
  archive: "POST /accounts/<Bank B>/archive con body {\"reason\": \"Cuenta cerrada en el banco\"}"
steps:
  - "Archivar Bank B"
  - "Listar cuentas sin y con includeArchived=true"
  - "Archivar Bank B por segunda vez"
expected_result:
  - "Bank B no aparece en el listado por defecto"
  - "Con includeArchived=true aparece con status ARCHIVED, archivedAt informado y saldo 0.00 BOB"
  - "Se emite accounts.AccountArchived.v1 con reason \"Cuenta cerrada en el banco\" y se escribe auditoría"
  - "El segundo archivo se rechaza con INVALID_STATUS_TRANSITION"
created: 2026-10-02
updated: 2026-10-03
---

# TC-ACCOUNTS-ARCHIVE-001 — Una cuenta archivada desaparece del listado por defecto pero sigue consultable con su saldo

## Intención

FR-ACCOUNTS-007: archivar ordena la vista sin perder información.

## Escenario

```gherkin
Cuando el usuario archiva "Bank B" con el motivo "Cuenta cerrada en el banco"
Entonces "Bank B" no aparece en el listado por defecto
  Y aparece al incluir archivadas, con saldo 0.00 BOB
```
