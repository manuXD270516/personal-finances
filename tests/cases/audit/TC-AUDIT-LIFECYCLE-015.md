---
id: TC-AUDIT-LIFECYCLE-015
title: "El recorrido de una categoría lista crear, archivar y desarchivar y el renombrado como anotación"
spec: audit/lifecycle-timeline
related_specs: ["classification/categories"]
requirement: "Recorrido de una categoría"
scenario: "Categoría renombrada, archivada y desarchivada"
requirement_status: confirmed
fr: ["FR-AUDIT-009", "FR-AUDIT-010", "FR-CLASSIFICATION-002"]
nfr: []
invariants: ["INV-019"]
priority: high
type: api
level: api
automation_status: not_automated
status: ready
regression_suite: false
phase: 1
tags: ["lifecycle", "classification", "api"]
error_code: null
preconditions:
  - "Workspace W1 de la Minimal Seed, usuario EDITOR"
  - "FixedClock 2026-03-10T10:00:00-04:00, avanzando 1 h por paso"
input: {"sequence": ["CREATE categoría de gasto \"Super\"", "PATCH nombre \"Supermercado\"", "ARCHIVE", "UNARCHIVE"]}
steps:
  - "Ejecutar la secuencia"
  - "GET W/categories/{categoryId}/lifecycle"
expected_result:
  - "items en orden: TRANSITION CREATE (∅ a ACTIVE), ANNOTATION changedFields [name], TRANSITION ARCHIVE (ACTIVE a ARCHIVED), TRANSITION UNARCHIVE (ARCHIVED a ACTIVE)"
  - "currentState ACTIVE y path [ACTIVE, ARCHIVED, ACTIVE]"
  - "Cada ítem tiene actor, occurredAt, origin y auditLogId; ARCHIVE lista el evento classification.CategoryArchived.v1"
  - "historyComplete true"
created: 2026-10-05
updated: 2026-10-05
---

# TC-AUDIT-LIFECYCLE-015 — El recorrido de una categoría lista crear, archivar y desarchivar y el renombrado como anotación

## Intención

El recorrido de una categoría muestra su camino de estados y separa los cambios descriptivos (D52).

## Escenario

```gherkin
Dada la categoría "Super" creada, renombrada, archivada y desarchivada
Cuando consulto su recorrido
Entonces veo crear, archivar y desarchivar en orden
  Y el renombrado como anotación
```

## Notas

- Cifras y fechas fijas; sin montos (la categoría no tiene ledger).
- Decisión del owner docs/31 D52 (2026-10-05). Pendiente de automatizar por la implementación (tareas 9.x de add-lifecycle-timeline).
