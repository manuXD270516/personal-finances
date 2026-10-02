---
id: TC-SECURITY-RLS-001
title: "RLS impide leer o escribir datos de otro workspace"
spec: security/access-control
related_specs: ["identity/workspace-membership"]
requirement: "Aislamiento de datos por workspace"
scenario: null
requirement_status: provisional
fr: [FR-IDENTITY-002]
nfr: [NFR-SEC-001]
invariants: []
priority: critical
type: security
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["rls", "multi-tenancy"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers con Minimal Seed (W1 y W2)"
  - "El rol pf_app no tiene BYPASSRLS y no es dueño de ninguna tabla"
input:
  session_workspace: "W1"
  tables:
    - "accounts.account"
    - "ledger.journal_entry"
    - "ledger.posting"
    - "txn.transaction"
    - "classification.category"
    - "audit.audit_log"
steps:
  - "SET LOCAL app.workspace_id = W1; SELECT * de cada tabla"
  - "INSERT de una fila con workspace_id = W2"
  - "UPDATE ... WHERE workspace_id = W2"
  - "Abrir una sesión sin app.workspace_id y hacer SELECT"
  - "Revisar pg_roles para pf_app"
expected_result:
  - "Solo se devuelven filas de W1 en todas las tablas"
  - "El INSERT con W2 falla por una violación de la política RLS"
  - "El UPDATE afecta 0 filas"
  - "Sin app.workspace_id no se ve ninguna fila de negocio"
  - "pf_app.rolbypassrls = false; pf_app no es dueño de ninguna tabla de negocio"
created: 2026-10-01
updated: 2026-10-01
---

# TC-SECURITY-RLS-001 — RLS impide leer o escribir datos de otro workspace

## Intención

RLS es defensa en profundidad en caso de que un error de la aplicación omita el filtrado por workspace (ARCHITECTURE §9, ADR-0023).

## Escenario

```gherkin
Dado que la sesión está acotada al workspace "W1"
Cuando el rol de aplicación consulta los postings
Entonces solo se devuelven los postings de "W1"
  Y se rechaza insertar una fila para "W2"
```

## Notas

- Toda tabla de negocio nueva debe agregarse a esta prueba; un escaneo del esquema falla si una tabla con workspace_id carece de política.
