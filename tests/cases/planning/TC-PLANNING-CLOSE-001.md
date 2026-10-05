---
id: TC-PLANNING-CLOSE-001
title: "El cierre es atómico: estado, bloqueo, snapshot, auditoría, transición y evento juntos o nada"
spec: planning/month-closing
related_specs: []
requirement: Cierre atómico del periodo
scenario: Falla al escribir el snapshot
requirement_status: provisional
fr:
  - FR-PLANNING-004
  - FR-PLANNING-005
nfr:
  - NFR-DATA-007
invariants:
  - INV-015
  - INV-029
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags:
  - month-closing
  - atomicity
error_code: null
preconditions:
  - '"2026-10" active, terminado y sin observaciones'
  - PostgreSQL real con rol pf_app
input:
  - close: 2026-10
    injectFailure: close_snapshot insert
  - close: 2026-10
steps:
  - Cerrar "2026-10" con falla inyectada en la escritura del snapshot
  - Registrar un gasto de 30.00 BOB con fecha 2026-10-20
  - Cerrar "2026-10" sin falla
expected_result:
  - 'Con falla: "2026-10" sigue active, sin lock, sin auditoría ni evento; el gasto de 30.00 BOB se acepta'
  - "Sin falla: periodo closed con closeCount 1, lock 2026-10-01..2026-10-31, snapshot 1, auditoría, transición active -> closed y un evento MonthClosed"
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-CLOSE-001 — El cierre es atómico: estado, bloqueo, snapshot, auditoría, transición y evento juntos o nada

## Intención

Un cierre a medias (lock sin snapshot o snapshot sin lock) violaría INV-015 o dejaría un mes cerrado sin evidencia.

## Escenario

```gherkin
Dado que "2026-10" está active y sin observaciones
Cuando el cierre falla al escribir el snapshot
Entonces "2026-10" sigue active y sin bloqueo
  Y un gasto de 30.00 BOB con fecha 2026-10-20 todavía se acepta
```

## Notas

- Cubre también "Cierre exitoso".
