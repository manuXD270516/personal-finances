---
id: TC-PLANNING-AUDIT-001
title: La activación y el recálculo de periodos se auditan una sola vez
spec: planning/financial-periods
related_specs:
  - audit/audit-trail
  - audit/lifecycle-timeline
requirement: Auditoría y evento de los cambios de periodo
scenario: Recálculo auditado
requirement_status: confirmed
fr:
  - FR-AUDIT-001
  - FR-AUDIT-009
nfr:
  - NFR-DATA-007
invariants:
  - INV-029
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - financial-periods
  - audit
error_code: null
preconditions:
  - '"2026-11" en draft'
  - Reloj en 2026-11-01T04:05Z, workspace en America/La_Paz
input:
  runs: 2
steps:
  - Ejecutar el proceso de periodos dos veces
  - Cambiar el día de inicio de 1 a 25
expected_result:
  - Una auditoría de activación con el proceso de periodos como actor y una transición draft -> active
  - La segunda ejecución no escribe auditoría ni transición
  - El recálculo de "2026-12" se audita con el rango anterior 2026-12-01..2026-12-31 y el nuevo 2026-12-25..2027-01-24
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-AUDIT-001 — La activación y el recálculo de periodos se auditan una sola vez

## Intención

INV-029: todo cambio auditado en la misma transacción; el recorrido del periodo depende de estos registros.

## Escenario

```gherkin
Dado que "2026-12" está en draft del 2026-12-01 al 2026-12-31
Cuando el día de inicio cambia de 1 a 25
Entonces la auditoría de "2026-12" registra el rango anterior y el nuevo del 2026-12-25 al 2027-01-24
```

## Notas

- La activación auditada se verifica en el mismo test; el evento en TC-PLANNING-EVENT-001.
