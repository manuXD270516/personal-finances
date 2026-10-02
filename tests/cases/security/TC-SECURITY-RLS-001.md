---
id: TC-SECURITY-RLS-001
title: RLS impide leer o escribir datos de otro workspace
spec: security/access-control
related_specs:
- identity/workspace-membership
requirement: Aislamiento de datos por workspace
scenario: Consulta sin filtro con contexto de W1
requirement_status: confirmed
fr:
- FR-IDENTITY-006
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
- multi-tenancy
error_code: null
preconditions:
- PostgreSQL mediante Testcontainers con Minimal Seed (W1 y W2, W2 Bank con 5000.00 BOB)
- Conexión con el rol pf_app
input:
  session_workspace: W1
  tables:
  - accounts.account
  - ledger.journal_entry
  - ledger.posting
  - txn.transaction
  - classification.category
  - audit.audit_log
  - iam.workspace
  - platform.idempotency_key
steps:
- 'Dentro de una transacción: set_config(''app.workspace_id'', W1, true); SELECT * sin WHERE de cada tabla'
- INSERT de una fila con workspace_id = W2
- UPDATE ... WHERE workspace_id = W2
expected_result:
- Solo se devuelven filas de W1 en todas las tablas; W2 Bank no aparece
- El INSERT con W2 falla por la política RLS (WITH CHECK)
- El UPDATE afecta 0 filas
created: 2026-10-01
updated: 2026-10-02
---

# TC-SECURITY-RLS-001 — RLS impide leer o escribir datos de otro workspace

## Intención

RLS es defensa en profundidad en caso de que un error de la aplicación omita el filtrado por workspace (ARCHITECTURE §9, ADR-0023).

## Escenario

```gherkin
Dado que la transacción está acotada al workspace "W1"
Cuando el rol de aplicación consulta los postings sin filtro
Entonces solo se devuelven los postings de "W1"
  Y se rechaza insertar una fila para "W2"
```

## Notas

- Toda tabla de negocio nueva se agrega a la lista parametrizada; el escaneo de catálogo es TC-SECURITY-RLS-004.
- Los chequeos de roles y de ausencia de contexto se movieron a TC-SECURITY-RLS-005 y TC-SECURITY-RLS-002.
