---
id: TC-ACCOUNTS-NODELETE-001
title: "Las cuentas no se pueden eliminar y una cuenta archivada conserva toda su historia"
spec: accounts/account-management
related_specs: ["audit/audit-trail"]
requirement: "Las cuentas no se eliminan"
scenario: "Cuenta archivada conserva su historia"
requirement_status: confirmed
fr: [FR-ACCOUNTS-008]
nfr: [NFR-DATA-012]
invariants: []
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/accounts/test/integration/pg-accounts.int.test.ts
  - apps/api/test/api/accounts.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["accounts", "no-hard-delete"]
error_code: null
preconditions: ["Old Bank (bank, BOB) con movimientos por 300.00 BOB y archivada", "PostgreSQL mediante Testcontainers"]
input:
  api: "DELETE /accounts/<Old Bank>"
  sql: "DELETE FROM accounts.account WHERE id = <Old Bank> como pf_app"
steps: ["Enviar el DELETE por API", "Ejecutar el DELETE SQL con el rol de aplicación", "Consultar transacciones, saldo e historial de Old Bank"]
expected_result:
  - "La API no expone la operación (405) y el contrato OpenAPI no define DELETE para cuentas"
  - "El DELETE SQL falla por falta de privilegio"
  - "Las transacciones, el saldo de 300.00 BOB y el historial de auditoría de Old Bank siguen consultables"
created: 2026-10-02
updated: 2026-10-03
---

# TC-ACCOUNTS-NODELETE-001 — Las cuentas no se pueden eliminar y una cuenta archivada conserva toda su historia

## Intención

FR-ACCOUNTS-008 y NFR-DATA-012: borrar una cuenta dejaría huérfanos postings y transacciones.

## Escenario

```gherkin
Dado "Old Bank" archivada con movimientos por 300.00 BOB
Cuando se intenta eliminarla
Entonces no existe operación de borrado
  Y su historia sigue consultable
```
