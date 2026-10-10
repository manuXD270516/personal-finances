---
id: TC-COMMITMENTS-SUBS-016
title: 'Un VIEWER no puede cancelar y cada cambio del EDITOR queda auditado'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Permisos, auditoría y aislamiento de suscripciones'
scenario: 'VIEWER intenta cancelar'
requirement_status: provisional
fr: ['FR-COMMITMENTS-012', 'FR-AUDIT-001']
nfr: ['NFR-SEC-003']
invariants: ['INV-029']
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['subscriptions', 'authorization', 'audit']
error_code: 'INSUFFICIENT_ROLE'
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"Streamly" ACTIVE plan "Premium"'
  - 'Miembros OWNER, EDITOR, VIEWER'
input:
  attempts: ['VIEWER cancel', 'EDITOR PATCH planName=Estándar']
steps:
  - 'VIEWER cancela'
  - 'EDITOR cambia el plan'
  - 'Consultar el audit log de la suscripción'
expected_result:
  - 'VIEWER ⇒ 403 INSUFFICIENT_ROLE y "Streamly" sigue ACTIVE'
  - 'Entrada de auditoría con actor EDITOR y plan "Premium" → "Estándar"'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-SUBS-016 — Un VIEWER no puede cancelar y cada cambio del EDITOR queda auditado

## Intención

Matriz de roles (docs/10 §14) y auditoría síncrona de toda mutación.

## Escenario

```gherkin
Cuando el VIEWER intenta cancelar "Streamly"
Entonces recibe INSUFFICIENT_ROLE
Cuando el EDITOR cambia el plan
Entonces la auditoría registra "Premium" → "Estándar"
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
