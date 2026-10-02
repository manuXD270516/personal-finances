---
id: TC-LEDGER-ISOLATION-001
title: El ledger no lee ni escribe datos de otro workspace y falla sin contexto
spec: ledger/journal-posting
related_specs: []
requirement: Aislamiento de workspace en el ledger
scenario: Posting contra una cuenta contable de otro workspace
requirement_status: confirmed
fr: []
nfr: [NFR-SEC-003, NFR-SEC-004]
invariants: [INV-025]
priority: critical
type: security
level: database-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [rls, multi-tenant, security]
error_code: REFERENCE_NOT_FOUND
preconditions:
- PostgreSQL vía Testcontainers, rol pf_app (sin BYPASSRLS)
- Workspaces W1 y W2, cada uno con Bank A (BOB) y asientos propios
input:
  cross_workspace_entry:
  - EXPENSE:BOB de W1 +10.00 BOB
  - Bank A de W2 -10.00 BOB
  pool_size: 1
steps:
- En una transacción de W1, registrar el asiento que referencia la cuenta contable de W2
- En una conexión nueva, consultar ledger.posting sin SET LOCAL app.workspace_id
- 'Con pool de 1 conexión: transacción con contexto W1 y luego consulta sin contexto en la misma conexión'
- Consultar postings desde W1 sin filtro WHERE workspace_id
expected_result:
- El asiento cruzado se rechaza con REFERENCE_NOT_FOUND y no se persiste nada en W1 ni en W2
- La consulta sin contexto falla (fail-closed, SQLSTATE PF002) en lugar de devolver 0 filas
- La conexión reutilizada no hereda el workspace anterior
- Desde W1 solo se ven postings de W1
created: &id001 2026-10-02
updated: *id001
---

# TC-LEDGER-ISOLATION-001 — El ledger no lee ni escribe datos de otro workspace y falla sin contexto

## Intención

INV-025 y ADR-0023: el aislamiento por workspace se impone en la base de datos además de en la aplicación.

## Escenario

```gherkin
Dado los workspaces "W1" y "W2"
Cuando en "W1" se registra un asiento contra la cuenta contable de "Bank A" de "W2"
Entonces se rechaza con el código "REFERENCE_NOT_FOUND"
  Y no se persiste nada
```
