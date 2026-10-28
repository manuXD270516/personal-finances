---
id: TC-SECURITY-RLS-007
title: "Sin contexto, ninguna tabla registrada devuelve filas ni un vacío sin PF002"
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
  - "Conexión con el rol pf_app sin app.workspace_id ni app.user_id fijados"
  - "platform.idempotency_key e iam.workspace_export vaciadas por el superusuario en la transacción revertida de la matriz (fix-rls-fail-closed-gaps)"
input:
  tables: "todas las de platform.workspace_scoped_table"
  operations: ["lectura filtrada por un workspace existente", "lectura sin filtro", "inserción"]
steps:
  - "Para cada tabla y operación, ejecutar sin contexto con la política vigente y registrar el resultado en la matriz"
  - "Listar como hallazgo cada operación que devuelve vacío sin PF002 y fallar si hay alguno"
expected_result:
  - "Ninguna operación devuelve filas de negocio"
  - "Ninguna operación devuelve vacío sin PF002: un hallazgo hace fallar el test indicando su tabla y su operación"
created: 2026-10-21
updated: 2026-10-28
---

# TC-SECURITY-RLS-007 — Sin contexto, ninguna tabla registrada devuelve filas ni un vacío sin PF002

## Intención

Recorre tabla por tabla el registro de tablas acotadas por workspace sin contexto y deja a la vista dónde el fail-closed no es ruidoso. Se escribió para comparar la política reescrita con la anterior; sin migración (D298) quedó como matriz permanente de la política vigente, que listaba los hallazgos sin fallar. El change `fix-rls-fail-closed-gaps` corrige los hallazgos de D296 y la convierte en un gate: cualquier vacío sin `PF002` hace fallar el test. Vacía antes las tablas cuya política se evaluaba fila por fila, para que el resultado no dependa de los datos.

## Escenario

```gherkin
Dada una transacción sin workspace fijado
Cuando se lee y se inserta en cada tabla registrada
Entonces ninguna operación devuelve filas de negocio
  Y ninguna devuelve vacío sin PF002; un hallazgo hace fallar la verificación
```

## Notas

- Change `optimize-rls-policy-overhead` (D287; reconvertido por D298, [docs/49](../../../docs/49-rls-no-migration-decision.md)). En verde en el job `integration` de #162; imprime el bloque `RLS-FAIL-CLOSED-MATRIX` y un `RLS-FAIL-CLOSED-FINDING` por hallazgo.
- **Hallazgos con la política vigente (job `integration` de #162):** `platform.idempotency_key` (lectura filtrada) e `iam.workspace_export` (lectura filtrada y sin filtro) devuelven vacío sin `PF002`. Registrados en docs/38; se corrigen en el change de seguridad aparte `fix-rls-fail-closed-gaps` (D296 de [docs/48](../../../docs/48-perf-and-rls-owner-decisions.md)).
- La comparación con una «política anterior» reconstruida se retiró en la tarea 4.2 (sin migración son idénticas); el test es `[TC-SECURITY-RLS-007] sin contexto ninguna tabla registrada devuelve filas y cada vacío sin PF002 queda listado como hallazgo`.
- **Endurecido por `fix-rls-fail-closed-gaps` (tarea 2.5):** falla ante cualquier hallazgo; los dos de #162 los corrige ese change (TC-SECURITY-RLS-013 y 015). Hasta implementar la tarea 2.5, el test sigue listando sin fallar. La matriz con el rol del worker es TC-SECURITY-RLS-017.
