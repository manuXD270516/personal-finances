---
id: TC-AUDIT-IMMUTABLE-001
title: "Los registros de auditoría no se pueden modificar ni borrar y las correcciones agregan registros nuevos"
spec: audit/audit-trail
related_specs: []
requirement: "Auditoría inmutable"
scenario: "Intento de modificar un registro de auditoría"
requirement_status: confirmed
fr: [FR-AUDIT-003]
nfr: []
invariants: [INV-029]
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/audit/test/integration/pg-audit-log.int.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["audit", "append-only"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers con migraciones aplicadas"
  - "Registro de auditoría de la edición de T1 de 120.00 a 102.00 BOB"
input:
  attempts: ["UPDATE como pf_app", "DELETE como pf_app", "TRUNCATE como pf_app", "UPDATE como pf_worker"]
  correction: "Editar T1 de 102.00 a 120.00 BOB"
steps:
  - "Ejecutar cada intento de mutación sobre audit.audit_log"
  - "Ejecutar la corrección y leer el historial de T1"
expected_result:
  - "Todos los intentos de UPDATE/DELETE/TRUNCATE fallan (sin privilegio o trigger forbid_mutation)"
  - "El registro original conserva before 120.00 BOB y after 102.00 BOB"
  - "Tras la corrección existen dos registros de T1 en orden cronológico y el primero no cambió"
created: 2026-10-02
updated: 2026-10-03
---

# TC-AUDIT-IMMUTABLE-001 — Los registros de auditoría no se pueden modificar ni borrar y las correcciones agregan registros nuevos

## Intención

Una auditoría alterable no tiene valor probatorio (FR-AUDIT-003, docs/08 §6).

## Escenario

```gherkin
Dado un registro de auditoría de la edición de 120.00 a 102.00 BOB
Cuando el rol de aplicación intenta modificarlo o borrarlo
Entonces la base de datos lo rechaza
  Y el registro conserva sus valores
```
