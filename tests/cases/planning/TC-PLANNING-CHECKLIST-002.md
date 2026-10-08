---
id: TC-PLANNING-CHECKLIST-002
title: La política de cierre por defecto y su cambio solo por el OWNER
spec: planning/month-closing
related_specs: []
requirement: Severidad configurable de los ítems del checklist
scenario: OWNER endurece la política
requirement_status: confirmed
fr:
  - FR-PLANNING-003
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - month-closing
  - checklist
  - authorization
error_code: INSUFFICIENT_ROLE
preconditions:
  - Workspace sin política guardada
  - '"2026-10" con 3 porciones sin categoría por 210.00 BOB'
  - Usuarios OWNER y EDITOR
input:
  - actor: OWNER
    change:
      UNCATEGORIZED: BLOCKING
  - actor: EDITOR
    change:
      UNRECONCILED_ACCOUNTS: WARNING
steps:
  - GET /planning/closing-policy
  - "OWNER: PUT con UNCATEGORIZED = BLOCKING"
  - GET checklist de "2026-10"
  - "EDITOR: PUT con UNRECONCILED_ACCOUNTS = WARNING"
expected_result:
  - Por defecto PENDING_TRANSACTIONS y UNRECONCILED_ACCOUNTS son BLOCKING; el resto WARNING
  - Tras el cambio del OWNER el ítem UNCATEGORIZED aparece bloqueante y la auditoría registra WARNING -> BLOCKING
  - El EDITOR recibe 403 INSUFFICIENT_ROLE y la política no cambia
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-CHECKLIST-002 — La política de cierre por defecto y su cambio solo por el OWNER

## Intención

FR-PLANNING-003: los ítems bloqueantes son configurables, pero solo por el OWNER.

## Escenario

```gherkin
Dado la política por defecto
Cuando el OWNER marca como bloqueante el ítem de porciones sin categoría
Entonces el checklist lo muestra como bloqueante
  Y el cambio queda auditado
```

## Notas

- Cubre "Política por defecto" y "EDITOR intenta cambiar la política".
