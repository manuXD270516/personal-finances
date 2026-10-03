---
id: TC-AUDIT-LIFECYCLE-006
title: "Un VIEWER ve el recorrido y otro workspace recibe recurso inexistente"
spec: audit/lifecycle-timeline
related_specs: ["security/access-control"]
requirement: "Recorrido visible para quien puede ver el elemento"
scenario: "VIEWER consulta el recorrido"
requirement_status: confirmed
fr: ["FR-AUDIT-010","FR-AUDIT-004"]
nfr: ["NFR-SEC-003"]
invariants: ["INV-025"]
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["lifecycle","authorization","rls"]
error_code: null
preconditions:
  - "Minimal Seed: viewer@demo.pfos.test es VIEWER de W1; outsider@demo.pfos.test es OWNER solo de W2"
  - "Gasto de 120.00 BOB en W1 corregido a 102.00 BOB por el EDITOR"
input: {"viewer":"GET W1/transactions/{id}/lifecycle","outsider":"GET W1/transactions/{id}/lifecycle"}
steps:
  - "El VIEWER consulta el recorrido"
  - "El usuario de W2 consulta el mismo recorrido"
expected_result:
  - "VIEWER: 200 con la transición REVISE, su actor (EDITOR) e instante"
  - "Usuario de W2: 404 idéntico al de un id inexistente, sin datos de W1"
created: 2026-10-03
updated: 2026-10-03
---

# TC-AUDIT-LIFECYCLE-006 — Un VIEWER ve el recorrido y otro workspace recibe recurso inexistente

## Intención

Extiende D28 (historial visible para VIEWER) al recorrido, sin abrir fugas entre workspaces.

## Escenario

```gherkin
Dado un gasto de W1 corregido por un EDITOR
Cuando un VIEWER de W1 consulta su recorrido
Entonces ve la transición de revisión
  Y un usuario de W2 recibe recurso inexistente
```

## Notas

- Cubre también el scenario "Usuario de otro workspace".
