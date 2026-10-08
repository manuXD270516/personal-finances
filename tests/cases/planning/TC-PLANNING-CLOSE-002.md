---
id: TC-PLANNING-CLOSE-002
title: Un ítem bloqueante impide el cierre con MONTH_CLOSING_BLOCKED
spec: planning/month-closing
related_specs: []
requirement: Cierre impedido por ítems bloqueantes
scenario: Cierre con pendientes
requirement_status: confirmed
fr:
  - FR-PLANNING-003
nfr: []
invariants: []
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
  - checklist
error_code: MONTH_CLOSING_BLOCKED
preconditions:
  - '"2026-10" terminado con 2 pendientes por 165.00 BOB'
  - Política por defecto
  - Usuario EDITOR
input:
  close: 2026-10
  acknowledgeWarnings: true
steps:
  - POST /periods/{id}/close con If-Match e Idempotency-Key
  - Registrar un gasto de 30.00 BOB con fecha 2026-10-20
expected_result:
  - 409 MONTH_CLOSING_BLOCKED con blockingItems = [PENDING_TRANSACTIONS]
  - '"2026-10" sigue active, sin snapshot ni lock; el gasto se acepta'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-CLOSE-002 — Un ítem bloqueante impide el cierre con MONTH_CLOSING_BLOCKED

## Intención

Un pendiente del mes cerrado nunca podría postearse; bloquear evita meses cerrados incompletos.

## Escenario

```gherkin
Dado que "2026-10" tiene 2 transacciones pendientes por 165.00 BOB
Cuando el EDITOR intenta cerrarlo
Entonces se rechaza con "MONTH_CLOSING_BLOCKED"
  Y no existe snapshot
```

## Notas

- Sin notas adicionales.
