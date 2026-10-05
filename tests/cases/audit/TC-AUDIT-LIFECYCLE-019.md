---
id: TC-AUDIT-LIFECYCLE-019
title: "El backfill deriva crear y archivar de una contraparte anterior al registro de transiciones"
spec: audit/lifecycle-timeline
related_specs: ["classification/counterparties"]
requirement: "Transiciones previas reconstruidas desde la auditoría"
scenario: "Contraparte anterior al registro de transiciones"
requirement_status: confirmed
fr: ["FR-AUDIT-012"]
nfr: []
invariants: []
priority: medium
type: integration
level: repository-integration
automation_status: not_automated
status: ready
regression_suite: false
phase: 1
tags: ["lifecycle", "classification", "backfill"]
error_code: null
preconditions:
  - "Contraparte \"Entel\" con registros de auditoría classification.counterparty.created y classification.counterparty.archived y sin filas en audit.lifecycle_transition"
input: {"job": "audit.lifecycle-backfill"}
steps:
  - "Ejecutar el job dos veces"
  - "GET W/counterparties/{entelId}/lifecycle"
expected_result:
  - "El recorrido muestra CREATE (∅ a ACTIVE) y ARCHIVE (ACTIVE a ARCHIVED), ambas con derived = true"
  - "historyComplete true; currentState ARCHIVED"
  - "La segunda corrida no deriva nada (idempotente)"
created: 2026-10-05
updated: 2026-10-05
---

# TC-AUDIT-LIFECYCLE-019 — El backfill deriva crear y archivar de una contraparte anterior al registro de transiciones

## Intención

Las contrapartes y categorías creadas antes de D52 recuperan su recorrido sin inventar pasos.

## Escenario

```gherkin
Dada "Entel" creada y archivada antes del registro de transiciones
Cuando corre la reconstrucción
Entonces su recorrido muestra crear y archivar derivadas
```

## Notas

- Las categorías provisionadas con el workspace antes de D52 no tienen auditoría propia (add-classification, decisión de implementación 2): su recorrido derivado queda vacío con historyComplete = false; nunca se inventa la creación.
- Decisión del owner docs/31 D52 (2026-10-05). Pendiente de automatizar por la implementación (tareas 9.x de add-lifecycle-timeline).
