---
id: TC-SECURITY-RLS-005
title: Los roles de base de datos de la aplicación no pueden saltarse RLS ni hacer DDL
spec: security/access-control
related_specs: []
requirement: Privilegios mínimos del rol de aplicación en base de datos
scenario: Verificación de privilegios
requirement_status: confirmed
fr: []
nfr:
- NFR-SEC-003
- NFR-SEC-016
invariants: []
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
- roles
- least-privilege
error_code: null
preconditions:
- Base migrada (Testcontainers)
input:
  roles:
  - pf_app
  - pf_worker
  - pf_bff
steps:
- Revisar pg_roles de cada rol
- Revisar los owners de las tablas de negocio
- Intentar CREATE TABLE y ALTER TABLE con cada rol
- Intentar SELECT sobre txn.transaction con pf_bff
expected_result:
- rolbypassrls = false y rolsuper = false para los tres roles
- 'Ninguno es owner de una tabla de negocio (owner: pf_migrator)'
- CREATE/ALTER fallan por permisos
- pf_bff no tiene acceso a tablas de negocio
created: 2026-10-02
updated: 2026-10-02
---

# TC-SECURITY-RLS-005 — Los roles de base de datos de la aplicación no pueden saltarse RLS ni hacer DDL

## Intención

El mínimo privilegio impide que un bug o una inyección desactive el aislamiento (docs/12 §5).

## Escenario

```gherkin
Dados los roles de base de datos de la API, el worker y el BFF
Cuando se inspeccionan sus atributos y permisos
Entonces ninguno puede saltarse RLS ni es dueño de tablas de negocio
```
