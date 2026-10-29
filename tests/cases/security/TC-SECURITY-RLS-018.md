---
id: TC-SECURITY-RLS-018
title: "La variante tolerante del contexto de workspace solo aparece en las políticas de usuario de workspaces y membresías"
spec: security/access-control
related_specs: []
requirement: "Verificación del aislamiento y del fail-closed de las políticas vigentes tabla por tabla"
scenario: "Uso acotado de la variante tolerante del contexto"
requirement_status: confirmed
fr: []
nfr: [NFR-SEC-003]
invariants: []
priority: high
type: security
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/db/rls-isolation.int.test.ts
status: automated
regression_suite: true
phase: 5
tags: ["rls", "fail-closed", "catalog"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers con todas las migraciones"
input:
  catalog: "pg_policies con roles pf_app o pf_worker cuyo qual o with_check menciona current_workspace_id_if_set"
  expected: ["iam.workspace.workspace_member_read", "iam.workspace_membership.membership_read"]
steps:
  - "Consultar pg_policies y filtrar por rol y por la mención de la función"
  - "Comprobar que cada política encontrada menciona también current_user_id"
expected_result:
  - "Las políticas encontradas son exactamente las dos esperadas"
  - "Las dos exigen también el usuario fijado"
created: 2026-10-28
updated: 2026-10-28
---

# TC-SECURITY-RLS-018 — La variante tolerante del contexto de workspace solo aparece en las políticas de usuario de workspaces y membresías

## Intención

`platform.current_workspace_id_if_set()` devuelve `NULL` sin contexto y nunca lanza. Su migración la reserva a las tablas de usuario de `iam` que además exigen el usuario. Usarla en `iam.workspace_export` abrió el hueco de D296. Este caso impide que vuelva a aparecer en una tabla de workspace, sin exigir una forma de política concreta (D298).

## Escenario

```gherkin
Dado el catálogo de políticas del rol de aplicación y del rol del worker
Cuando se buscan las que usan la variante del contexto que devuelve nulo
Entonces solo aparecen las de lectura de workspaces y de membresías
  Y las dos exigen el usuario fijado
```

## Notas

- Change `fix-rls-fail-closed-gaps`, tarea 2.7. Debe fallar antes de la migración (`iam.workspace_export.ws_isolation`).
