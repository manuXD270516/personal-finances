---
id: TC-ACCOUNTS-ARCHIVE-003
title: "Reactivar una cuenta archivada permite volver a registrar movimientos y queda auditado"
spec: accounts/account-management
related_specs: ["audit/audit-trail"]
requirement: "Reactivar cuenta"
scenario: "Reactivar y registrar"
requirement_status: confirmed
fr: [FR-ACCOUNTS-007]
nfr: []
invariants: [INV-026, INV-029]
priority: high
type: integration
level: api
automation_status: automated
automated_tests:
  - packages/contexts/accounts/src/domain/account.test.ts
  - packages/contexts/accounts/src/application/accounts.service.test.ts
  - apps/api/test/api/accounts.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["accounts", "archive"]
error_code: "ACCOUNT_NAME_TAKEN"
preconditions:
  - "Old Bank (bank, BOB) archivada con saldo 300.00 BOB"
  - "Old Card (credit_card, BOB) archivada y existe otra cuenta activa llamada Old Card"
input:
  - {command: "POST /accounts/<Old Bank>/reactivate y luego gasto de 20.00 BOB", expected: "ok"}
  - {command: "POST /accounts/<Old Card>/reactivate", expected: "ACCOUNT_NAME_TAKEN"}
steps: ["Reactivar Old Bank y registrar el gasto", "Reactivar Old Card"]
expected_result:
  - "Old Bank queda ACTIVE con saldo 280.00 BOB"
  - "Existe un registro de auditoría de la reactivación y se emite accounts.AccountReactivated.v1 con previousStatus ARCHIVED"
  - "Old Card se rechaza con ACCOUNT_NAME_TAKEN y sigue archivada"
created: 2026-10-02
updated: 2026-10-03
---

# TC-ACCOUNTS-ARCHIVE-003 — Reactivar una cuenta archivada permite volver a registrar movimientos y queda auditado

## Intención

FR-ACCOUNTS-007: archivar es reversible y la reversión deja rastro.

## Escenario

```gherkin
Dado "Old Bank" archivada con 300.00 BOB
Cuando el usuario la reactiva y registra un gasto de 20.00 BOB
Entonces "Old Bank" queda activa con 280.00 BOB
  Y la reactivación está auditada
```
