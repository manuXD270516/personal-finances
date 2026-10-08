---
id: TC-PLANNING-REOPEN-002
title: La reapertura exige rol OWNER y motivo
spec: planning/month-closing
related_specs: []
requirement: Reapertura auditada solo por el OWNER
scenario: EDITOR intenta reabrir
requirement_status: confirmed
fr:
  - FR-PLANNING-006
nfr:
  - NFR-SEC-003
invariants: []
priority: high
type: security
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/month-closing.api.test.ts
  - apps/web/src/ui/planning/closing.test.tsx
  - packages/contexts/planning/src/application/closing.service.test.ts
status: automated
regression_suite: false
phase: 2
tags:
  - month-closing
  - reopen
  - authorization
error_code: INSUFFICIENT_ROLE
preconditions:
  - '"2026-10" closed'
  - Usuarios EDITOR y OWNER
input:
  - actor: EDITOR
    reason: corregir
  - actor: OWNER
    reason: ""
steps:
  - "EDITOR: POST reopen con motivo"
  - "OWNER: POST reopen con motivo vacío"
expected_result:
  - "EDITOR: 403 INSUFFICIENT_ROLE"
  - "OWNER sin motivo: 400 VALIDATION_FAILED"
  - '"2026-10" sigue closed en ambos casos'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-REOPEN-002 — La reapertura exige rol OWNER y motivo

## Intención

docs/10 §10: solo el OWNER reabre; el motivo es obligatorio para la auditoría.

## Escenario

```gherkin
Dado que "2026-10" está closed
Cuando un EDITOR intenta reabrirlo
Entonces la respuesta es 403 con código "INSUFFICIENT_ROLE"
```

## Notas

- Cubre "Reapertura sin motivo".
