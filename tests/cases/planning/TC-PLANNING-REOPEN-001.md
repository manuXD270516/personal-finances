---
id: TC-PLANNING-REOPEN-001
title: El OWNER reabre un mes con motivo, se quita el bloqueo y el snapshot no cambia
spec: planning/month-closing
related_specs: []
requirement: Reapertura auditada solo por el OWNER
scenario: OWNER reabre octubre
requirement_status: provisional
fr:
  - FR-PLANNING-006
nfr: []
invariants:
  - INV-015
  - INV-029
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags:
  - month-closing
  - reopen
error_code: null
preconditions:
  - '"2026-10" closed con snapshot 1 (Bank A 5200.00 BOB)'
  - '"2026-11" no cerrado'
  - Usuario OWNER
input:
  reopen: 2026-10
  reason: Faltó registrar la comisión bancaria
steps:
  - POST /periods/{id}/reopen con If-Match e Idempotency-Key
  - Registrar un gasto de 15.00 BOB con fecha 2026-10-31
  - Leer auditoría y snapshot 1
expected_result:
  - '"2026-10" reopened con reopenCount 1'
  - El gasto de 15.00 BOB se acepta
  - La auditoría registra el motivo; el snapshot 1 sigue con 5200.00 BOB
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-REOPEN-001 — El OWNER reabre un mes con motivo, se quita el bloqueo y el snapshot no cambia

## Intención

FR-PLANNING-006: corregir un mes cerrado es posible pero explícito, auditado y sin reescribir la evidencia anterior.

## Escenario

```gherkin
Dado que "2026-10" está closed
Cuando el OWNER lo reabre con el motivo "Faltó registrar la comisión bancaria"
Entonces "2026-10" queda reopened
  Y el snapshot 1 sigue registrando 5200.00 BOB en "Bank A"
```

## Notas

- Sin notas adicionales.
