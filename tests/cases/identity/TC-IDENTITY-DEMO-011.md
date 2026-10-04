---
id: TC-IDENTITY-DEMO-011
title: "La purga elimina todas las filas del workspace demo y deja solo la lápida"
spec: identity/demo-data
related_specs: ["ledger/journal-posting","audit/audit-trail","platform/event-delivery"]
requirement: "Purga completa del workspace demo"
scenario: "No queda ningún dato del workspace demo"
requirement_status: confirmed
fr: ["FR-IDENTITY-015"]
nfr: ["NFR-DATA-012"]
invariants: []
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests: ["apps/api/test/db/demo-purge.int.test.ts","apps/api/test/demo/demo-data.int.test.ts"]
status: automated
regression_suite: true
phase: 1
tags: ["demo-data","purge"]
error_code: null
preconditions:
  - "Workspace demo cargado y limpiado (CLEANING)"
  - "platform.workspace_scoped_table contiene todas las tablas con workspace_id"
input: {"job":"demo.purge"}
steps:
  - "Ejecutar el job de purga"
  - "Contar filas con el workspace_id del demo en cada tabla registrada"
expected_result:
  - "Todas las tablas registradas tienen 0 filas con ese workspace_id (ledger, transacciones, tasas, clasificación, auditoría, outbox/inbox, read models)"
  - "iam.workspace conserva la lápida con status PURGED sin datos de negocio"
  - "platform.demo_workspace_run registra purged_at y las filas eliminadas por tabla"
created: 2026-10-03
updated: 2026-10-04
---

# TC-IDENTITY-DEMO-011 — La purga elimina todas las filas del workspace demo y deja solo la lápida

## Intención

"Completamente removible" (D36) se verifica contando filas, no confiando en el archivo.

## Escenario

```gherkin
Dado un workspace demo limpiado
Cuando termina la purga
Entonces no queda ninguna fila con su workspace_id
  Y existe el registro de purga con las filas eliminadas por tabla
```

## Notas

- El chequeo de catálogo garantiza que una tabla nueva con workspace_id no quede fuera del registro.
