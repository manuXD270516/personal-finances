---
id: TC-ACCOUNTS-INSTITUTION-003
title: "Editar una institución no altera sus cuentas ni sus saldos y queda auditado"
spec: accounts/institutions
related_specs: ["audit/audit-trail", "accounts/account-management"]
requirement: "Edición de institución"
scenario: "Cambiar el sitio web"
requirement_status: confirmed
fr: [FR-ACCOUNTS-012]
nfr: []
invariants: [INV-029]
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/accounts/src/application/accounts.service.test.ts
  - apps/api/test/api/accounts.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["institutions", "audit"]
error_code: null
preconditions: ["Bank A (saldo 1000.00 BOB) asociada a Banco Andino Demo (website https://andino.demo.pfos.test)"]
input:
  request: "PATCH /institutions/<Banco Andino Demo> con body {\"website\": \"https://www.andino.demo.pfos.test\"}"
steps: ["Enviar el PATCH con If-Match vigente", "Leer Bank A y la auditoría de la institución"]
expected_result:
  - "La institución tiene el nuevo sitio web y su version aumenta en 1"
  - "Bank A sigue asociada a la institución con saldo 1000.00 BOB y sin asientos nuevos"
  - "Existe un registro de auditoría con el sitio web anterior y el nuevo"
created: 2026-10-02
updated: 2026-10-03
---

# TC-ACCOUNTS-INSTITUTION-003 — Editar una institución no altera sus cuentas ni sus saldos y queda auditado

## Intención

FR-ACCOUNTS-012: mantener el catálogo sin efectos colaterales en el dinero.

## Escenario

```gherkin
Dado "Bank A" con 1000.00 BOB asociada a "Banco Andino Demo"
Cuando el usuario cambia el sitio web de la institución
Entonces "Bank A" no cambia
  Y la edición queda auditada
```
