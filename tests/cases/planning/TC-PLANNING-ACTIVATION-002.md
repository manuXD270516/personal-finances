---
id: TC-PLANNING-ACTIVATION-002
title: El EDITOR activa manualmente un periodo iniciado pero no uno futuro
spec: planning/financial-periods
related_specs: []
requirement: Activación manual de un periodo iniciado
scenario: Activación de un periodo futuro
requirement_status: confirmed
fr:
  - FR-PLANNING-001
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - financial-periods
error_code: PERIOD_NOT_STARTED
preconditions:
  - Hoy es 2026-11-01 en La Paz
  - '"2026-11" y "2026-12" en draft (el proceso aún no corrió)'
  - Usuario EDITOR
input:
  - activate: 2026-11
  - activate: 2026-12
steps:
  - POST /periods/{id}/activate de "2026-11" con If-Match
  - Ejecutar el proceso de periodos
  - POST /periods/{id}/activate de "2026-12"
expected_result:
  - '"2026-11" pasa a active una sola vez; el proceso posterior no lo modifica ni publica otro evento'
  - '"2026-12" responde 409 PERIOD_NOT_STARTED y sigue en draft'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-ACTIVATION-002 — El EDITOR activa manualmente un periodo iniciado pero no uno futuro

## Intención

Cubre el hueco entre medianoche y la siguiente corrida del job sin permitir activar meses futuros.

## Escenario

```gherkin
Dado que hoy es 2026-11-01 y "2026-12" está en draft
Cuando el EDITOR intenta activar "2026-12"
Entonces se rechaza con "PERIOD_NOT_STARTED"
```

## Notas

- Requirement Should; cubre también "Activación antes de que corra el proceso".
