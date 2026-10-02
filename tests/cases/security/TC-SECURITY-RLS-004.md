---
id: TC-SECURITY-RLS-004
title: El quality gate falla si una tabla de negocio no tiene RLS habilitado y forzado
spec: security/access-control
related_specs: []
requirement: Tablas de negocio con aislamiento obligatorio
scenario: Migración con tabla sin política
requirement_status: confirmed
fr: []
nfr:
- NFR-SEC-003
invariants: []
priority: critical
type: security
level: architecture
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags:
- rls
- catalog
- ci
error_code: null
preconditions:
- Base migrada con todas las migraciones del repositorio
- Fixture de migración que crea una tabla con workspace_id sin política
input:
  allowlist:
  - iam.user
  - iam.bff_session
  - fx.currency
  - platform.inbox
steps:
- Consultar pg_class/pg_policy para toda tabla con columna workspace_id en schemas de negocio
- Ejecutar el chequeo con y sin el fixture
expected_result:
- 'Sin fixture: toda tabla tiene relrowsecurity y relforcerowsecurity verdaderos y al menos una política'
- 'Con fixture: el chequeo falla nombrando la tabla'
created: 2026-10-02
updated: 2026-10-02
---

# TC-SECURITY-RLS-004 — El quality gate falla si una tabla de negocio no tiene RLS habilitado y forzado

## Intención

Olvidar la política de una tabla nueva es el riesgo principal de ADR-0023; el chequeo lo vuelve imposible de mergear.

## Escenario

```gherkin
Dada una migración que agrega una tabla de negocio sin política de aislamiento
Cuando corre el quality gate
Entonces el chequeo falla indicando la tabla
```
