---
id: TC-PLANNING-STATE-001
title: Las transiciones no declaradas del periodo se rechazan con INVALID_STATUS_TRANSITION
spec: planning/financial-periods
related_specs:
  - audit/lifecycle-timeline
requirement: Ciclo de vida declarado del periodo
scenario: Cerrar un periodo en borrador
requirement_status: confirmed
fr:
  - FR-PLANNING-001
  - FR-AUDIT-009
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/planning/src/domain/financial-period.test.ts
status: automated
regression_suite: false
phase: 2
tags:
  - financial-periods
  - lifecycle
error_code: INVALID_STATUS_TRANSITION
preconditions:
  - '"2026-12" en draft, "2026-10" en active, "2026-09" en closed'
input:
  - command: close
    period: 2026-12
  - command: reopen
    period: 2026-10
    reason: corrección
    role: OWNER
  - command: activate
    period: 2026-09
steps:
  - Ejecutar cada comando sobre el agregado
expected_result:
  - Cada comando se rechaza con INVALID_STATUS_TRANSITION
  - Los estados no cambian y no se registra ninguna transición
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-STATE-001 — Las transiciones no declaradas del periodo se rechazan con INVALID_STATUS_TRANSITION

## Intención

La máquina declarada (docs/31 D37) evita estados imposibles, p. ej. cerrar un mes que aún no empezó.

## Escenario

```gherkin
Dado que "2026-12" está en draft
Cuando se intenta cerrarlo
Entonces se rechaza con "INVALID_STATUS_TRANSITION"
  Y "2026-12" sigue en draft
```

## Notas

- Cubre los tres scenarios del requirement.
