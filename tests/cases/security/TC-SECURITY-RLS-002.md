---
id: TC-SECURITY-RLS-002
title: Sin contexto de workspace no se lee ni se escribe ninguna fila de negocio
spec: security/access-control
related_specs: []
requirement: Aislamiento fail-closed sin contexto de workspace
scenario: null
requirement_status: confirmed
fr: []
nfr:
- NFR-SEC-003
invariants:
- INV-025
priority: critical
type: security
level: database-integration
automation_status: automated
automated_tests:
- apps/api/test/db/rls-isolation.int.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- rls
- fail-closed
error_code: null
preconditions:
- PostgreSQL mediante Testcontainers con Minimal Seed
- Conexión con el rol pf_app; conexión reutilizada que antes fijó W1
input:
  tablas:
  - txn.transaction
  - ledger.posting
  - accounts.account
  insert:
    amount: '75.00'
    currency: BOB
steps:
- Abrir una transacción sin fijar app.workspace_id y hacer SELECT de cada tabla
- Intentar INSERT de una transacción de 75.00 BOB sin contexto
expected_result:
- Cada SELECT falla con SQLSTATE PF002 (contexto de workspace ausente); nunca devuelve filas
- El INSERT falla con PF002 y no se persiste nada
created: 2026-10-02
updated: 2026-10-02
---

# TC-SECURITY-RLS-002 — Sin contexto de workspace no se lee ni se escribe ninguna fila de negocio

## Intención

Un olvido de contexto debe cerrar el acceso, nunca abrirlo a todos los workspaces (ADR-0023, docs/08 §1.4; el fallo es ruidoso, no un resultado vacío).

## Escenario

```gherkin
Dada una transacción sin workspace fijado
Cuando el rol de aplicación consulta las transacciones
Entonces la consulta falla con el error PF002 de contexto ausente
Y no obtiene ninguna fila de negocio
```

## Notas

- Variante con la conexión reutilizada (app.workspace_id = '' tras un SET LOCAL previo).
