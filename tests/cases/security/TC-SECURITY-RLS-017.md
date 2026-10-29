---
id: TC-SECURITY-RLS-017
title: "Sin contexto, el rol del worker no lee ninguna tabla registrada salvo la entrega de eventos declarada"
spec: security/access-control
related_specs: []
requirement: "Verificación del aislamiento y del fail-closed de las políticas vigentes tabla por tabla"
scenario: "Matriz sin contexto con el rol del worker"
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
tags: ["rls", "fail-closed", "worker"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers con Minimal Seed y la migración de este change"
  - "Transacción como superusuario con SET LOCAL ROLE pf_worker, sin app.workspace_id ni app.user_id"
input:
  tables: "todas las de platform.workspace_scoped_table"
  operations: ["lectura filtrada por un workspace existente", "lectura sin filtro", "inserción"]
  allowed: ["platform.outbox (lecturas)", "platform.inbox (lecturas)", "platform.dead_letter (lecturas)"]
steps:
  - "Para cada tabla y operación, ejecutar sin contexto con pf_worker y registrar el resultado"
  - "Comparar con la lista declarada de lecturas entre workspaces por diseño"
expected_result:
  - "Toda operación fuera de la lista falla con PF002 o 42501"
  - "Una lectura no declarada que devuelve filas o un vacío sin error hace fallar el test con su tabla y su operación"
created: 2026-10-28
updated: 2026-10-28
---

# TC-SECURITY-RLS-017 — Sin contexto, el rol del worker no lee ninguna tabla registrada salvo la entrega de eventos declarada

## Intención

La matriz de TC-SECURITY-RLS-007 solo recorría `pf_app`. `pf_worker` hereda sus políticas pero tiene otras propias, y por una de ellas (`retention_scan`) veía los exports de todos los workspaces sin contexto. Este caso deja a la vista cualquier política del worker que lea sin contexto fuera de la entrega de eventos (outbox, inbox y dead-letter).

## Escenario

```gherkin
Dada una transacción del rol del worker sin workspace ni usuario fijados
Cuando se lee y se inserta en cada tabla registrada
Entonces toda operación falla con el error de contexto ausente o de permisos, salvo las lecturas declaradas de la entrega de eventos
  Y una lectura no declarada que devuelve filas o un vacío sin error hace fallar la verificación
```

## Notas

- Change `fix-rls-fail-closed-gaps`, tarea 2.6. Ampliar la lista exige cambiar el test y el requirement.
- Automatizado (2026-10-28). Además de las lecturas de outbox, inbox y dead-letter, la lista declarada admite la inserción de prueba (`DEFAULT VALUES`) en `platform.inbox` y `platform.dead_letter` (el worker escribe ahí por diseño) y en `fx.rate_anomaly_review` y `fx.rate_withdrawal`: esa inserción choca con las restricciones de las columnas (23502/23514) antes de llegar a la política. Para las dos de FX el test comprueba en el catálogo que su `WITH CHECK` usa `current_workspace_id()`. Antes de la migración el test falló con las lecturas de `platform.idempotency_key` e `iam.workspace_export` sin `PF002`.
