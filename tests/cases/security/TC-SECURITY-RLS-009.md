---
id: TC-SECURITY-RLS-009
title: "El plan de la consulta de saldo por cuenta con la política reescrita no agrega un nodo entre el índice y la agregación"
spec: security/access-control
related_specs: ["ledger/balances"]
requirement: "Las políticas de aislamiento no agregan trabajo por fila al plan"
scenario: "Plan de la consulta de saldo por cuenta"
requirement_status: confirmed
fr: []
nfr: [NFR-SEC-003, NFR-PERF-005]
invariants: []
priority: high
type: security
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/db/rls-isolation.int.test.ts
  - apps/api/test/db/rls-policy-variants.int.test.ts
status: automated
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
updated: 2026-10-23
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
- Variante elegida: V2 (diferencia mediana de la consulta INCLUDE 0,000 ms frente a 0,268 ms de V0; mismos nodos `Aggregate > Index Only Scan` con InitPlan, sin nodo `Result`), medida en el job `integration` de #162 (PostgreSQL 18.6, 13 000 postings). Detalle por variante en la tarea 1.3 de `openspec/changes/optimize-rls-policy-overhead/tasks.md`.
