---
id: TC-SECURITY-RLS-007
title: "Sin contexto, ninguna tabla registrada devuelve filas y cada vacío sin PF002 queda listado como hallazgo"
spec: security/access-control
related_specs: []
requirement: "Verificación del aislamiento y del fail-closed de las políticas vigentes tabla por tabla"
scenario: "Matriz sin contexto por tabla registrada"
requirement_status: confirmed
fr: []
nfr: [NFR-SEC-003]
invariants: [INV-025]
priority: critical
type: security
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/db/rls-isolation.int.test.ts
status: automated
regression_suite: true
phase: 5
tags: ["rls", "fail-closed"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers con Minimal Seed"
  - "Conexión con el rol pf_app sin app.workspace_id fijado"
input:
  tables: "todas las de platform.workspace_scoped_table"
  operations: ["lectura filtrada por un workspace existente", "lectura sin filtro", "inserción"]
steps:
  - "Para cada tabla y operación, ejecutar sin contexto con la política vigente y registrar el resultado en la matriz"
  - "Listar como hallazgo cada operación que devuelve vacío sin PF002"
expected_result:
  - "Ninguna operación devuelve filas de negocio"
  - "Toda operación que devuelve vacío sin PF002 queda listada como hallazgo con su tabla y su operación"
created: 2026-10-21
updated: 2026-10-24
---

# TC-SECURITY-RLS-007 — Sin contexto, ninguna tabla registrada devuelve filas y cada vacío sin PF002 queda listado como hallazgo

## Intención

Recorre tabla por tabla el registro de tablas acotadas por workspace sin contexto y deja a la vista dónde el fail-closed no es ruidoso. Se escribió para comparar la política reescrita con la anterior; sin migración (D298) queda como matriz permanente de la política vigente. No relaja el requirement «Aislamiento fail-closed sin contexto de workspace»: un hallazgo se corrige en un change de seguridad aparte (D296).

## Escenario

```gherkin
Dada una transacción sin workspace fijado
Cuando se lee y se inserta en cada tabla registrada
Entonces ninguna operación devuelve filas de negocio
  Y cada operación que devuelve vacío sin PF002 queda listada como hallazgo
```

## Notas

- Change `optimize-rls-policy-overhead` (D287; reconvertido por D298, [docs/49](../../../docs/49-rls-no-migration-decision.md)). En verde en el job `integration` de #162; imprime el bloque `RLS-FAIL-CLOSED-MATRIX` y un `RLS-FAIL-CLOSED-FINDING` por hallazgo.
- **Hallazgos con la política vigente (job `integration` de #162):** `platform.idempotency_key` (lectura filtrada) e `iam.workspace_export` (lectura filtrada y sin filtro) devuelven vacío sin `PF002`. Registrados en docs/38; se corrigen en un change de seguridad aparte (D296 de [docs/48](../../../docs/48-perf-and-rls-owner-decisions.md)), por redactar.
- La comparación con una «política anterior» reconstruida se retiró en la tarea 4.2 (sin migración son idénticas); el test es `[TC-SECURITY-RLS-007] sin contexto ninguna tabla registrada devuelve filas y cada vacío sin PF002 queda listado como hallazgo`.
