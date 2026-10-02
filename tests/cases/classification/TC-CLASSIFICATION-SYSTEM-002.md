---
id: TC-CLASSIFICATION-SYSTEM-002
title: Las categorías de sistema no se archivan ni renombran pero sí cambian de color
spec: classification/categories
related_specs: []
requirement: Las categorías de sistema están protegidas
scenario: Archivar una categoría de sistema
requirement_status: confirmed
fr: [FR-CLASSIFICATION-003]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [system-categories]
error_code: SYSTEM_CATEGORY_IMMUTABLE
preconditions:
- Workspace con la categoría de sistema FEES ("Comisiones")
input:
- request: POST /api/v1/workspaces/{W1}/categories/{FEES}/archive
- request: PATCH /api/v1/workspaces/{W1}/categories/{FEES}
  body:
    name: Cargos
- request: PATCH /api/v1/workspaces/{W1}/categories/{FEES}
  body:
    color: '#C62828'
steps:
- Enviar cada solicitud con If-Match vigente
expected_result:
- Archivar responde 409 SYSTEM_CATEGORY_IMMUTABLE y la categoría sigue activa
- Renombrar responde 409 SYSTEM_CATEGORY_IMMUTABLE
- Cambiar el color responde 200 y systemCode sigue siendo FEES
created: 2026-10-02
updated: 2026-10-02
---

# TC-CLASSIFICATION-SYSTEM-002 — Las categorías de sistema no se archivan ni renombran pero sí cambian de color

## Intención

FR-CLASSIFICATION-003: categorías de sistema no eliminables ni archivables.

## Escenario

```gherkin
Dada la categoría de sistema "Comisiones"
Cuando el usuario intenta archivarla
Entonces se rechaza con "SYSTEM_CATEGORY_IMMUTABLE"
Cuando cambia su color a "#C62828"
Entonces el cambio se aplica
```

## Notas

- Convertirla en subcategoría o cambiar su tipo también debe rechazarse (casos borde).
