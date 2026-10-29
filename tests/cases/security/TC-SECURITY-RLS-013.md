---
id: TC-SECURITY-RLS-013
title: "Sin contexto, las claves de idempotencia fallan con PF002 aunque la tabla esté vacía o el filtro no encuentre filas"
spec: security/access-control
related_specs: ["platform/api-conventions"]
requirement: "Fail-closed de las claves de idempotencia sin contexto"
scenario: "Lecturas sin contexto con el registro vacío o sin claves del workspace"
requirement_status: confirmed
fr: []
nfr: [NFR-SEC-003, NFR-SEC-004]
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
tags: ["rls", "fail-closed", "idempotency"]
error_code: "PF002"
preconditions:
  - "PostgreSQL mediante Testcontainers con las migraciones de main y la de este change"
  - "W1 «Personal Demo» sin claves de idempotencia"
  - "Transacción como pf_app sin app.workspace_id ni app.user_id"
input:
  table: "platform.idempotency_key"
  operations:
    - "lectura filtrada por workspace_id = W1"
    - "lectura sin filtro con la tabla vaciada por el superusuario en la misma transacción revertida"
    - "búsqueda por scope_id y key"
    - "inserción de una clave de W1"
steps:
  - "Abrir una transacción como superusuario, vaciar platform.idempotency_key con session_replication_role = replica y asumir pf_app con el contexto vacío"
  - "Ejecutar cada operación dentro de un savepoint y registrar el SQLSTATE"
  - "Revertir la transacción"
expected_result:
  - "Las cuatro operaciones fallan con SQLSTATE PF002"
  - "Ninguna devuelve un resultado vacío sin error"
created: 2026-10-28
updated: 2026-10-28
---

# TC-SECURITY-RLS-013 — Sin contexto, las claves de idempotencia fallan con PF002 aunque la tabla esté vacía o el filtro no encuentre filas

## Intención

Cierra el primer hallazgo de D296. Con la política vigente, el `CASE` de `idempotency_key_scope` solo se evalúa fila por fila: si no hay filas que recorrer, la consulta devuelve vacío sin `PF002`. Con el conjunto `scope_id = platform.current_idempotency_scope_id()`, el error se produce al planificar, como en la forma vigente de las demás tablas.

## Escenario

```gherkin
Dada una transacción del rol de aplicación sin workspace ni usuario fijados
  Y "W1 Personal Demo" sin claves de idempotencia
Cuando se lee el registro filtrando por "W1 Personal Demo", y sin filtro con el registro vacío
Entonces las dos lecturas fallan con el error de contexto ausente (PF002)
  Y ninguna devuelve un vacío en silencio
```

## Notas

- Change `fix-rls-fail-closed-gaps` (D296, [docs/48](../../../docs/48-perf-and-rls-owner-decisions.md)), tarea 2.1. Falló antes de la migración (lectura filtrada y tabla vacía devolvían `OK:0`) y pasa con ella (2026-10-28).
