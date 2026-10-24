---
id: TC-SECURITY-RLS-009
title: "El plan de la consulta de saldo por cuenta con la política reescrita no agrega un nodo entre el índice y la agregación"
spec: security/access-control
related_specs: ["ledger/balances"]
requirement: "Las políticas de aislamiento no agregan trabajo por fila al plan"
scenario: "Plan de la consulta de saldo por cuenta"
requirement_status: provisional
fr: []
nfr: [NFR-SEC-003, NFR-PERF-005]
invariants: []
priority: high
type: security
level: database-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 5
tags: ["rls", "plan", "performance"]
error_code: null
preconditions:
  - "Workspace con 10 864 postings en varias cuentas y ANALYZE ejecutado"
  - "Migración de las políticas reescritas aplicada"
input:
  query: "saldo por cuenta con acceso solo por índice (índice de saldos con INCLUDE)"
steps:
  - "EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON) con pf_app y contexto, y con superusuario sin RLS"
  - "Comparar los nodos que procesan filas, sin contar el InitPlan del contexto"
expected_result:
  - "Ambos planes usan Index Only Scan sobre el mismo índice"
  - "El plan con política no tiene un nodo Result ni otro nodo entre el acceso por índice y el Aggregate"
created: 2026-10-21
updated: 2026-10-24
---

# TC-SECURITY-RLS-009 — El plan de la consulta de saldo por cuenta con la política reescrita no agrega un nodo entre el índice y la agregación

## Intención

El sobrecosto medido (0,805 ms en 10 864 filas) es un nodo `Result` con `One-Time Filter` por el que pasan todas las filas. Este caso fija en el job `integration` del PR, sin esperar al nightly, que la forma nueva no lo produce.

## Escenario

```gherkin
Dado un workspace con 10 864 postings
Cuando se obtiene el plan de la consulta de saldo por cuenta con y sin la política
Entonces ambos usan el mismo acceso solo por índice
  Y el plan con política no agrega un nodo entre el índice y la agregación
```

## Notas

- Change `optimize-rls-policy-overhead` (D287), decisión 4. La cantidad de filas viene del EXPLAIN del issue #147.
- **Descartado por decisión del owner (D298, [docs/49](../../../docs/49-rls-no-migration-decision.md), 2026-10-24).** No se migran las políticas, así que el plan de la consulta INCLUDE con la política reescrita no tiene objeto y el requirement «Las políticas de aislamiento no agregan trabajo por fila al plan» salió del delta del change. Queda con `requirement_status: provisional` solo mientras existan en `main` los tests omitidos que lo citan; en la tarea 4.2 pasa a `deprecated` (`deprecated_by_change: optimize-rls-policy-overhead`) en el mismo commit que los retira, para no romper la regla R5 de trazabilidad.
