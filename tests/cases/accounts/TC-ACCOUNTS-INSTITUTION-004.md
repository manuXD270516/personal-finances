---
id: TC-ACCOUNTS-INSTITUTION-004
title: "Una institución con cuentas se archiva, nunca se elimina, y sus cuentas conservan la asociación"
spec: accounts/institutions
related_specs: ["accounts/account-management"]
requirement: "Las instituciones se archivan, no se eliminan"
scenario: "Archivar una institución con cuentas"
requirement_status: confirmed
fr: [FR-ACCOUNTS-013]
nfr: [NFR-DATA-012]
invariants: []
priority: high
type: integration
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["institutions", "archive", "no-hard-delete"]
error_code: "INSTITUTION_ARCHIVED"
preconditions: ["Banco Andino Demo asociada a Bank A (saldo 1000.00 BOB)", "PostgreSQL mediante Testcontainers"]
input:
  archive: "POST /institutions/<Banco Andino Demo>/archive"
  delete_api: "DELETE /institutions/<Banco Andino Demo>"
  delete_sql: "DELETE FROM accounts.institution como pf_app"
  new_account: {name: "Bank H", type: "BANK", currency: "BOB", institution: "Banco Andino Demo"}
steps:
  - "Archivar la institución y listar instituciones por defecto e incluyendo archivadas"
  - "Leer Bank A"
  - "Intentar DELETE por API y por SQL"
  - "Crear Bank H asociada a la institución archivada"
expected_result:
  - "La institución no aparece en el listado por defecto y sí con includeArchived=true"
  - "Bank A sigue mostrando Banco Andino Demo con saldo 1000.00 BOB"
  - "El DELETE por API no existe (405) y el DELETE SQL falla por privilegios"
  - "Bank H se rechaza con INSTITUTION_ARCHIVED (409)"
created: 2026-10-02
updated: 2026-10-02
---

# TC-ACCOUNTS-INSTITUTION-004 — Una institución con cuentas se archiva, nunca se elimina, y sus cuentas conservan la asociación

## Intención

FR-ACCOUNTS-013: borrar una institución referenciada dejaría cuentas huérfanas.

## Escenario

```gherkin
Dado "Banco Andino Demo" asociada a "Bank A" con 1000.00 BOB
Cuando el usuario archiva la institución
Entonces no aparece en el listado por defecto
  Y "Bank A" conserva la asociación y su saldo
```

## Notas

- El último resultado cubre también el requirement Should "Institución archivada no asignable".
