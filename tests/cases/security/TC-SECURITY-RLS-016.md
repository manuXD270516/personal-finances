---
id: TC-SECURITY-RLS-016
title: "El barrido de retención lee con el rol de mantenimiento solo los exports listos vencidos, sin poder escribirlos"
spec: security/access-control
related_specs: ["identity/workspace-portability"]
requirement: "Fail-closed de las exportaciones del workspace sin contexto y barrido de retención con rol de mantenimiento"
scenario: "Barrido de retención con el rol de mantenimiento"
requirement_status: confirmed
fr: [FR-IDENTITY-010]
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
tags: ["rls", "export", "retention"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers con la migración de este change"
  - "Exportaciones: READY vencida de W1, READY vigente de W2 y DISCARDED de W2"
  - "Conexión como pf_worker sin contexto, con SET LOCAL ROLE pf_maintenance"
input:
  query: "SELECT id, workspace_id, requested_by FROM iam.workspace_export WHERE status = READY AND expires_at <= now()"
  forbidden: ["SELECT wrapped_key", "SELECT object_key", "UPDATE status = EXPIRED"]
steps:
  - "Con pf_maintenance, ejecutar la consulta del barrido"
  - "Con pf_maintenance, intentar leer wrapped_key y object_key, y marcar la exportación como EXPIRED"
  - "Ejecutar WorkspaceExportService.expireDue con los adapters reales y el pool de pf_worker"
expected_result:
  - "La consulta devuelve solo la exportación READY vencida de W1"
  - "Leer wrapped_key u object_key falla con 42501 y el UPDATE falla"
  - "expireDue expira la de W1 con el contexto de W1 y deja la auditoría identity.export.expired"
created: 2026-10-28
updated: 2026-10-28
---

# TC-SECURITY-RLS-016 — El barrido de retención lee con el rol de mantenimiento solo los exports listos vencidos, sin poder escribirlos

## Intención

El barrido `identity.export-retention` era la razón de la variante tolerante en `ws_isolation`. Con la corrección, la lectura entre workspaces queda en `pf_maintenance` (ADR-0023), limitada a los `READY` vencidos y a cinco columnas, y la expiración sigue con el contexto de cada workspace.

## Escenario

```gherkin
Dadas una exportación lista vencida de "W1 Personal Demo", una lista vigente y una descartada de "W2 Other Demo"
Cuando el barrido, sin workspace fijado y con el rol de mantenimiento, busca las vencidas
Entonces solo ve la de "W1 Personal Demo", sin la clave envuelta ni la ubicación del archivo
  Y no puede marcarla como expirada con ese rol
  Y el job la expira con el contexto de "W1 Personal Demo" y lo audita
```

## Notas

- Change `fix-rls-fail-closed-gaps`, tarea 2.4. La expiración por la cola real del worker la sigue cubriendo TC-IDENTITY-EXPORT-007.
- Automatizado (2026-10-28) en `rls-isolation.int.test.ts`: la consulta del barrido, las lecturas prohibidas y el `UPDATE` con una conexión real de `pf_worker` y `SET LOCAL ROLE pf_maintenance`. La expiración completa con los adapters reales (`WorkspaceExportService.expireDue`, contexto de W1 y auditoría `identity.export.expired`) la ejercita TC-IDENTITY-EXPORT-007 por la cola real del worker (`workspace-export-lifecycle.api.test.ts`), que ahora pasa por `findExpired` con `pf_maintenance`.
