---
id: TC-SECURITY-RLS-015
title: "Sin contexto, las exportaciones del workspace fallan con PF002 para el rol de aplicación y el del worker"
spec: security/access-control
related_specs: ["identity/workspace-portability"]
requirement: "Fail-closed de las exportaciones del workspace sin contexto y barrido de retención con rol de mantenimiento"
scenario: "Lecturas sin contexto de las exportaciones"
requirement_status: confirmed
fr: [FR-IDENTITY-010]
nfr: [NFR-SEC-003]
invariants: [INV-025]
priority: critical
type: security
level: database-integration
automation_status: not_automated
status: draft
regression_suite: true
phase: 5
tags: ["rls", "fail-closed", "export"]
error_code: "PF002"
preconditions:
  - "PostgreSQL mediante Testcontainers con la migración de este change"
  - "Una exportación READY de W1 «Personal Demo»"
  - "Transacciones como pf_app y como pf_worker (SET LOCAL ROLE) sin app.workspace_id ni app.user_id"
input:
  table: "iam.workspace_export"
  roles: ["pf_app", "pf_worker"]
  reads: ["filtrada por workspace_id = W1", "sin filtro", "sin filtro con la tabla vaciada en la transacción revertida"]
steps:
  - "Para cada rol, ejecutar cada lectura dentro de un savepoint y registrar el SQLSTATE"
  - "Revertir la transacción"
expected_result:
  - "Todas las lecturas fallan con SQLSTATE PF002 para los dos roles"
  - "Ninguna devuelve la exportación de W1 ni un vacío sin error"
created: 2026-10-28
updated: 2026-10-28
---

# TC-SECURITY-RLS-015 — Sin contexto, las exportaciones del workspace fallan con PF002 para el rol de aplicación y el del worker

## Intención

Cierra el segundo hallazgo de D296. `ws_isolation` comparaba con `current_workspace_id_if_set()`, que devuelve `NULL` sin contexto y nunca lanza. Con la forma vigente `workspace_id = platform.current_workspace_id()`, el error se produce al planificar. El rol del worker hereda `ws_isolation` y deja de ver los exports vencidos sin contexto: los lee con el rol de mantenimiento (TC-SECURITY-RLS-016).

## Escenario

```gherkin
Dada una exportación lista de "W1 Personal Demo"
Cuando el rol de aplicación y el rol del worker, sin workspace fijado, leen las exportaciones filtrando por "W1 Personal Demo" y sin filtro
Entonces todas las lecturas fallan con el error de contexto ausente (PF002)
  Y ninguna devuelve la exportación de "W1 Personal Demo"
```

## Notas

- Change `fix-rls-fail-closed-gaps` (D296), tarea 2.3. Debe fallar antes de la migración y pasar después.
