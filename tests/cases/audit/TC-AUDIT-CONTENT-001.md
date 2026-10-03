---
id: TC-AUDIT-CONTENT-001
title: "La entrada de auditoría registra actor, workspace, diferencias, origen y correlación con montos exactos"
spec: audit/audit-trail
related_specs: ["transactions/transaction-recording"]
requirement: "Contenido del registro de auditoría"
scenario: "Edición de monto de una transacción"
requirement_status: confirmed
fr: [FR-AUDIT-002]
nfr: []
invariants: [INV-001]
priority: high
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/audit/src/domain/audit-record.test.ts
  - packages/contexts/audit/src/application/audit-recorder.test.ts
  - packages/contexts/audit/test/integration/pg-audit-log.int.test.ts
  - apps/api/test/api/audit.api.test.ts
  - packages/platform/src/nest/request-context.middleware.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["audit"]
error_code: null
preconditions:
  - "FixedClock 2026-03-15T14:00:00Z"
  - "Usuario EDITOR autenticado U1 en W1"
  - "Solicitud desde la UI con correlationId C1"
  - "Transacción T1 de 120.00 BOB"
input:
  command: "Editar el monto de la transacción T1 de 120.00 → 102.00 BOB"
  void: "Anular una transacción de 30.00 BOB con motivo \"Duplicada\""
steps:
  - "Ejecutar la edición"
  - "Leer la entrada de auditoría"
  - "Ejecutar la anulación con motivo y leer su entrada"
expected_result:
  - "La entrada tiene actor USER U1, workspaceId W1, acción de edición de transacción, aggregate T1 con su nueva versión, before {amount: \"120.00\", currency: \"BOB\"}, after {amount: \"102.00\", currency: \"BOB\"}, correlationId C1, origin ui, occurredAt 2026-03-15T14:00:00Z"
  - "Los montos se almacenan como cadenas decimales con su moneda, nunca como números"
  - "La entrada de la anulación contiene reason \"Duplicada\""
created: 2026-10-01
updated: 2026-10-03
---

# TC-AUDIT-CONTENT-001 — La entrada de auditoría registra actor, workspace, diferencias, origen y correlación con montos exactos

## Intención

Una pista de auditoría solo es útil si es completa (FR-AUDIT-002) y si los montos se conservan exactos (INV-001). La inmutabilidad se verifica en TC-AUDIT-IMMUTABLE-001.

## Escenario

```gherkin
Dado que el usuario "U1" edita la transacción "T1" de 120.00 a 102.00 BOB desde la UI con correlación "C1"
Cuando se lee la pista de auditoría de "T1"
Entonces muestra "U1", los montos "120.00" y "102.00" en BOB, el origen "ui" y la correlación "C1"
```

## Notas

- Automatización (add-audit-trail): La edición de monto y la anulación con motivo se ejercen con registros de agregado `Transaction` escritos por `AuditPort` (fixture) hasta `add-transaction-recording`; el origen `ui`, la correlación y el instante, además, con `PATCH /workspaces/{id}` real.
