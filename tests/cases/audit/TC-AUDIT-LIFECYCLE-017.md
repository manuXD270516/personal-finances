---
id: TC-AUDIT-LIFECYCLE-017
title: "Archivar una categoría de sistema se rechaza sin registrar transición"
spec: audit/lifecycle-timeline
related_specs: ["classification/categories"]
requirement: "Recorrido de una categoría"
scenario: "Archivar una categoría de sistema"
requirement_status: confirmed
fr: ["FR-AUDIT-009", "FR-CLASSIFICATION-003"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
status: ready
regression_suite: false
phase: 1
tags: ["lifecycle", "classification", "api"]
error_code: SYSTEM_CATEGORY_IMMUTABLE
preconditions:
  - "Workspace W1 recién creado: categoría de sistema \"Comisiones\" (systemCode FEES) provisionada con el workspace"
input: {"command": "POST W/categories/{comisionesId}/archive"}
steps:
  - "Intentar archivar \"Comisiones\""
  - "GET W/categories/{comisionesId}/lifecycle"
expected_result:
  - "La solicitud responde SYSTEM_CATEGORY_IMMUTABLE"
  - "El recorrido tiene un solo ítem: TRANSITION CREATE (∅ a ACTIVE) con origin system"
  - "currentState ACTIVE; ninguna transición ni anotación nueva"
created: 2026-10-05
updated: 2026-10-05
---

# TC-AUDIT-LIFECYCLE-017 — Archivar una categoría de sistema se rechaza sin registrar transición

## Intención

Una operación rechazada no deja transiciones, y las categorías provisionadas con el workspace tienen su creación registrada (D52, D54).

## Escenario

```gherkin
Dada la categoría de sistema "Comisiones"
Cuando intento archivarla
Entonces se rechaza con SYSTEM_CATEGORY_IMMUTABLE
  Y su recorrido sigue con solo crear
```

## Notas

- La provisión síncrona del catálogo (docs/31 D54) registra CREATE de cada categoría en la misma transacción que la creación del workspace.
- Decisión del owner docs/31 D52 (2026-10-05). Pendiente de automatizar por la implementación (tareas 9.x de add-lifecycle-timeline).
