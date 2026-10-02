---
id: TC-AUDIT-CONTENT-001
title: "La entrada de auditoría registra actor, workspace, conjunto de cambios y correlación, y es inmutable"
spec: audit/audit-trail
related_specs: []
requirement: "Pista de auditoría transaccional"
scenario: null
requirement_status: provisional
fr: [FR-AUDIT-001]
nfr: []
invariants: []
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["audit"]
error_code: null
preconditions:
  - "FixedClock 2026-03-15T14:00:00Z"
  - "Usuario EDITOR autenticado U1 en W1"
  - "Solicitud con correlationId C1"
input:
  command: "Editar el monto de la transacción T1 de 120.00 → 102.00 BOB"
steps:
  - "Ejecutar el comando"
  - "Leer la entrada de auditoría"
  - "Intentar UPDATE/DELETE de la fila de auditoría como pf_app"
expected_result:
  - "La entrada de auditoría tiene actor U1, workspaceId W1, action transaction.edited, aggregate T1, before {amount: \"120.00\"}, after {amount: \"102.00\"}, correlationId C1, occurredAt 2026-03-15T14:00:00Z"
  - "Los montos se almacenan como cadenas"
  - "La base de datos rechaza el UPDATE/DELETE"
created: 2026-10-01
updated: 2026-10-01
---

# TC-AUDIT-CONTENT-001 — La entrada de auditoría registra actor, workspace, conjunto de cambios y correlación, y es inmutable

## Intención

Una pista de auditoría solo es útil si es completa y resistente a la manipulación.

## Escenario

```gherkin
Dado que el usuario "U1" edita la transacción "T1" de 120.00 a 102.00 BOB
Cuando se lee la pista de auditoría
Entonces muestra "U1", los montos antes y después y el id de correlación
  Y la entrada de auditoría no puede modificarse
```
