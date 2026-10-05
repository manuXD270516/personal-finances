---
id: TC-AUDIT-LIFECYCLE-016
title: "Archivar una categoría registra la transición archivar en ella y en cada subcategoría activa"
spec: audit/lifecycle-timeline
related_specs: ["classification/categories"]
requirement: "Recorrido de una categoría"
scenario: "Archivar una categoría con subcategorías"
requirement_status: confirmed
fr: ["FR-AUDIT-009", "FR-AUDIT-010", "FR-CLASSIFICATION-002"]
nfr: []
invariants: ["INV-029"]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/lifecycle-export.api.test.ts
  - packages/contexts/classification/src/application/classification.service.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["lifecycle", "classification", "api"]
error_code: null
preconditions:
  - "Categoría de gasto \"Servicios básicos\" con subcategorías activas \"Luz\" y \"Agua\""
  - "FixedClock 2026-03-10T10:00:00-04:00"
input: {"command": "POST W/categories/{serviciosBasicosId}/archive"}
steps:
  - "Archivar \"Servicios básicos\""
  - "Consultar el recorrido de \"Servicios básicos\", \"Luz\" y \"Agua\""
expected_result:
  - "Los tres recorridos terminan en TRANSITION ARCHIVE (ACTIVE a ARCHIVED) con estado actual ARCHIVED"
  - "Las tres transiciones comparten actor, occurredAt y correlationId"
  - "Si la escritura de una transición falla, ninguna de las tres categorías queda archivada (misma UoW)"
created: 2026-10-05
updated: 2026-10-05
---

# TC-AUDIT-LIFECYCLE-016 — Archivar una categoría registra la transición archivar en ella y en cada subcategoría activa

## Intención

El archivado en cascada es una sola operación y deja huella en cada agregado que cambia de estado (D52).

## Escenario

```gherkin
Dada "Servicios básicos" con "Luz" y "Agua" activas
Cuando la archivo
Entonces las tres muestran la transición archivar con la misma correlación
```

## Notas

- Atomicidad: mismo patrón que TC-AUDIT-LIFECYCLE-002 (fallo inyectado en la escritura de la transición).
- Decisión del owner docs/31 D52 (2026-10-05). Automatizado en las tareas 9.x de add-lifecycle-timeline.
