---
id: TC-AUDIT-LIFECYCLE-024
title: "Un VIEWER exporta el recorrido y un usuario de otro workspace recibe 404"
spec: audit/lifecycle-timeline
related_specs: ["identity/workspace-membership"]
requirement: "Exportación del recorrido en CSV"
scenario: "Exportación por un VIEWER y desde otro workspace"
requirement_status: confirmed
fr: ["FR-AUDIT-013"]
nfr: ["NFR-SEC-003"]
invariants: []
priority: high
type: security
level: api
automation_status: not_automated
status: ready
regression_suite: false
phase: 1
tags: ["lifecycle", "export", "security", "rbac"]
error_code: NOT_FOUND
preconditions:
  - "W1 con un gasto de 120.00 BOB y un VIEWER"
  - "Usuario de W2 sin membresía en W1"
input: {"requests": ["VIEWER de W1: GET W1/transactions/{id}/lifecycle/export?format=csv", "Usuario de W2 con su contexto de W2: mismo id, formatos csv y pdf"]}
steps:
  - "Exportar como VIEWER de W1"
  - "Intentar exportar como usuario de W2"
expected_result:
  - "El VIEWER recibe 200 con el recorrido completo"
  - "El usuario de W2 recibe 404 NOT_FOUND idéntico al de un id inexistente, en CSV y en PDF, sin datos de W1"
created: 2026-10-05
updated: 2026-10-05
---

# TC-AUDIT-LIFECYCLE-024 — Un VIEWER exporta el recorrido y un usuario de otro workspace recibe 404

## Intención

La exportación respeta exactamente la visibilidad del recorrido (D28, D52).

## Escenario

```gherkin
Dado un gasto de W1
Cuando un VIEWER de W1 lo exporta y un usuario de W2 lo intenta
Entonces el VIEWER recibe el archivo
  Y el de W2 recibe la respuesta de inexistente
```

## Notas

- Por el BFF un no miembro de W1 recibe 403 WORKSPACE_ACCESS_DENIED del guard (como en TC-AUDIT-LIFECYCLE-006); el 404 se verifica por API con el id de W1 bajo W2.
- Decisión del owner docs/31 D52 (2026-10-05). Pendiente de automatizar por la implementación (tareas 9.x de add-lifecycle-timeline).
