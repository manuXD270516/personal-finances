---
id: TC-PLATFORM-EVENTS-021
title: "Una cabeza bloqueada por otra transacción retiene a sus sucesores y no frena a los demás agregados"
spec: platform/event-delivery
related_specs: []
requirement: "Selección de cabezas del relay acotada e independiente de las estadísticas"
scenario: "Una cabeza bloqueada retiene a sus sucesores"
requirement_status: provisional
fr: []
nfr: ["NFR-PERF-008", "NFR-REL-008"]
invariants: []
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 8
tags: ["ordering", "relay", "outbox", "skip-locked", "fix-outbox-relay-head-query"]
error_code: null
preconditions:
  - "PostgreSQL real con el relay como pf_worker y una segunda conexión que bloquea filas"
  - "Datos sintéticos; ningún dato del owner"
input: {"aggregate_A": "v1 y v2 pendientes", "aggregates_B_C": "v1 pendiente cada uno", "lock": "FOR UPDATE sobre v1 de A desde otra conexión"}
steps:
  - "Confirmar v1 y v2 del agregado A y v1 de los agregados B y C"
  - "Desde otra conexión, abrir una transacción y bloquear con FOR UPDATE la fila de v1 de A"
  - "Correr un lote del relay"
  - "Liberar el bloqueo (ROLLBACK) y correr dos lotes más"
expected_result:
  - "El primer lote publica v1 de B y de C; v1 y v2 de A siguen pendientes"
  - "Tras liberar el bloqueo, un lote publica v1 de A y uno posterior v2 de A"
created: 2026-11-17
updated: 2026-11-17
---

# TC-PLATFORM-EVENTS-021 — Una cabeza bloqueada por otra transacción retiene a sus sucesores y no frena a los demás agregados

## Intención

`SKIP LOCKED` salta la cabeza bloqueada, pero la subconsulta (que no bloquea) la sigue viendo como pendiente: su sucesor no puede adelantarse. Garantiza que el cambio de consulta no altera la semántica frente a filas bloqueadas.

## Escenario

```gherkin
Dado v1 y v2 del agregado A pendientes y v1 de A bloqueada por otra transacción
Cuando el relay corre un lote
Entonces publica las cabezas de los demás agregados
  Y v1 y v2 de A siguen pendientes
Cuando se libera el bloqueo
Entonces v1 de A se publica antes que v2 de A, en lotes distintos
```

## Notas

- Determinista: el bloqueo se toma y se libera explícitamente; no depende de timing.
