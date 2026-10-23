---
id: TC-SECURITY-RLS-007
title: "Sin contexto, ninguna operación lee ni escribe filas en ninguna tabla registrada con la política reescrita"
spec: security/access-control
related_specs: []
requirement: "Reescritura de las políticas de aislamiento sin pérdida de aislamiento"
scenario: "Sin contexto ninguna operación lee ni escribe filas en ninguna tabla registrada"
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
tags: ["rls", "fail-closed", "policy-rewrite"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers, con la migración de las políticas reescritas aplicada"
  - "Conexión con el rol pf_app sin app.workspace_id fijado"
  - "Workspaces W1 y W2 existentes"
input:
  tables: "todas las de platform.workspace_scoped_table"
  operations: ["lectura filtrada por un workspace existente", "lectura sin filtro", "inserción"]
  states: ["tabla sin filas", "tabla con al menos una fila de W2 (Minimal Seed)"]
steps:
  - "Estado A: sobre una base migrada sin datos de negocio (o en las tablas que la seed deja vacías), ejecutar sin contexto cada operación en cada tabla registrada, cada una en su propio SAVEPOINT, y registrar el resultado"
  - "Estado B: con la Minimal Seed cargada, en cada tabla registrada que tenga al menos una fila de W2 (como mínimo cuentas, asientos, postings y saldos del ledger), ejecutar sin contexto las mismas operaciones y registrar el resultado"
  - "Tras cada inserción, contar como superusuario las filas de la tabla y compararlas con las previas"
  - "Imprimir la matriz por tabla, estado y operación (RLS-FAIL-CLOSED-MATRIX), con la comparación informativa con la política anterior"
expected_result:
  - "Cada operación termina en uno de estos resultados: error PF002, resultado vacío, o rechazo con otro error (p. ej. 23514 o 42501) sin fila afectada"
  - "Ninguna lectura devuelve filas de negocio, en ningún estado"
  - "Ninguna inserción persiste una fila: el conteo como superusuario no cambia"
  - "En el estado B ninguna lectura devuelve las filas de W2"
  - "No se exige que el resultado coincida con el de la política anterior; la diferencia (PF002 frente a vacío en tablas sin filas) es esperada (D297)"
created: 2026-10-21
updated: 2026-10-23
---

# TC-SECURITY-RLS-007 — Sin contexto, ninguna operación lee ni escribe filas en ninguna tabla registrada con la política reescrita

## Intención

Una política con `ANY (ARRAY[(SELECT platform.current_workspace_id())])` evalúa el contexto como InitPlan, de forma diferida: si la operación no llega a evaluar ninguna fila, la función puede no ejecutarse y no lanzar `PF002`. El owner aceptó ese efecto (D297): lo que se exige es el invariante de seguridad, que el contexto ausente nunca conceda acceso. Este caso lo demuestra tabla por tabla, con la tabla vacía y con filas de otro workspace.

## Escenario

```gherkin
Dada una transacción sin workspace fijado y las políticas reescritas
Cuando se lee con filtro, se lee sin filtro y se inserta en cada tabla registrada
  primero con la tabla sin filas y después, donde las haya, con filas de "W2 Other Demo"
Entonces cada operación falla con PF002, devuelve vacío o es rechazada sin afectar ninguna fila
  Y ninguna lectura devuelve filas de negocio y ninguna inserción persiste una fila
  Y con filas de "W2 Other Demo" en la tabla, ninguna lectura devuelve esas filas
```

## Notas

- Change `optimize-rls-policy-overhead` (D287). Escenario reescrito el 2026-10-23 por D297 ([docs/49](../../../docs/49-rls-failclosed-decision.md)): antes exigía el mismo resultado que la política anterior.
- **Observado en la fase b (PostgreSQL 16 local, a confirmar en el job `integration`).** Con la política anterior, `platform.current_workspace_id()` se evaluaba al planificar y la consulta fallaba con `PF002` aunque la tabla estuviera vacía. Con V2, en una base sin datos, 51 de 300 operaciones en 33 tablas pasan de `PF002` a vacío (p. ej. lecturas de `ledger.entry_reversal`, `fx.exchange_rate`, `debt.credit_card_terms`) y la inserción por defecto en `fx.rate_anomaly_review` pasa de `PF002` a `23514`. Con al menos una fila sigue fallando con `PF002`. Nunca se devuelve ni se escribe una fila de otro workspace. Todos esos resultados cumplen este caso.
- **Hallazgos previos (D296, job `integration` de #162, PostgreSQL 18.6).** Con la política anterior, `platform.idempotency_key` (lectura filtrada) e `iam.workspace_export` (lectura filtrada y sin filtro) ya devolvían vacío sin `PF002`. Cumplen el invariante de este caso, pero se revisan en el change de seguridad aparte (pendiente, docs/38).
- El test de `apps/api/test/db/rls-isolation.int.test.ts` todavía verifica la equivalencia anterior: se ajusta a este escenario en la tarea 2.2 y se confirma en el job `integration`.
