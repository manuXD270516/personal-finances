---
id: TC-SECURITY-RLS-011
title: "El quality gate falla si una migración agrega una política de aislamiento sin la forma canónica"
spec: security/access-control
related_specs: []
requirement: "Forma canónica obligatoria de las políticas de aislamiento"
scenario: "Migración con una política en la forma anterior"
requirement_status: confirmed
fr: []
nfr: [NFR-SEC-003]
invariants: []
priority: high
type: security
level: architecture
automation_status: automated
automated_tests:
  - apps/api/test/db/rls-isolation.int.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["rls", "catalog", "ci"]
error_code: null
preconditions:
  - "Base migrada con todas las migraciones del repositorio"
  - "Fixture: tabla con workspace_id y política forzada para pf_app en la forma anterior (sin la forma canónica)"
input: {}
steps:
  - "Ejecutar la regla de forma canónica sin el fixture"
  - "Crear el fixture y ejecutar la regla"
expected_result:
  - "Sin fixture la regla no informa violaciones"
  - "Con el fixture la regla falla nombrando la tabla y la política"
created: 2026-10-21
updated: 2026-10-23
---

# TC-SECURITY-RLS-011 — El quality gate falla si una migración agrega una política de aislamiento sin la forma canónica

## Intención

Sin una regla, la próxima tabla copiaría la forma anterior y volvería el trabajo por fila. Igual que TC-SECURITY-RLS-004 para el `FORCE`.

## Escenario

```gherkin
Dada una pull request que agrega una tabla de negocio con una política en la forma anterior
Cuando corre el chequeo de catálogo
Entonces el quality gate falla indicando la tabla y la política
```

## Notas

- Change `optimize-rls-policy-overhead` (D287), decisión 5. La regla aplica a todas las políticas que usan el contexto de workspace (D294 de [docs/48](../../../docs/48-perf-and-rls-owner-decisions.md)).
- **Forma canónica elegida (2026-10-23, experimento de la tarea 1.3):** `<col> = ANY (ARRAY[(SELECT platform.current_workspace_id())])` (variante V2). `pg_get_expr` la devuelve como `ANY (ARRAY[( SELECT platform.current_workspace_id() AS current_workspace_id)])`; la regla (`RLS_CANONICAL_CONTEXT_FORM` en `apps/api/test/support/db.ts`) tolera ese espacio y el `AS`. Las políticas que además comparan con `platform.current_user_id()` usan la misma forma para esa función.
