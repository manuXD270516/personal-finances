# 55: Preguntas del change de seguridad del fail-closed de RLS (fix-rls-fail-closed-gaps)

> **Estado:** Resuelto por el owner el 2026-10-28 (D308–D310, al final) · **Fecha:** 2026-10-28 · **Relacionado:** [48-perf-and-rls-owner-decisions.md](48-perf-and-rls-owner-decisions.md) (D296), [49-rls-no-migration-decision.md](49-rls-no-migration-decision.md) (D298), [38-estado-y-pendientes.md](38-estado-y-pendientes.md) §4, change [`fix-rls-fail-closed-gaps`](../openspec/changes/fix-rls-fail-closed-gaps/proposal.md), [ADR-0023](adr/0023-multi-tenancy-and-row-level-security.md)

D296 manda corregir en un change de seguridad aparte el hueco que encontró TC-SECURITY-RLS-007. Sin contexto, `platform.idempotency_key` (lectura filtrada) e `iam.workspace_export` (lectura filtrada y sin filtro) devuelven vacío sin `PF002`. El design del change explica la causa y propone la corrección. Estas preguntas quedan para el owner. **[B]** marca la que bloquea parte de la implementación; las demás tienen una recomendación que el design ya adopta y que se puede revertir antes de fusionar.

## Resumen de la causa

- **`platform.idempotency_key`:** la política es un `CASE` (claves de alcance de usuario o de workspace) que el planner no evalúa al planificar, sino fila por fila. Si el filtro no encuentra filas o la tabla está vacía, no se evalúa y no lanza `PF002`.
- **`iam.workspace_export`:** la política compara con `current_workspace_id_if_set()`, que devuelve `NULL` sin contexto y nunca lanza. Se eligió así para que el barrido de retención de exports (`identity.export-retention`, rol `pf_worker`) pudiera leer los vencidos de todos los workspaces sin contexto.
- Ninguna otra política de `pf_app` o `pf_worker` sobre tablas de workspace tiene el patrón (inventario en el design). La forma vigente `workspace_id = current_workspace_id()` lanza al planificar incluso con la tabla vacía.

## Preguntas

### 1. [B] Rol con el que el barrido de retención lee los exports vencidos

Para que `iam.workspace_export` falle sin contexto, el barrido de retención ya no puede leer como `pf_worker` sin contexto: `pf_worker` hereda la política de `pf_app`, que pasaría a lanzar `PF002`. Necesita otra forma de encontrar los exports vencidos de todos los workspaces. Bloquea el grupo 3 de tareas (migración y worker), porque define qué rol de BD gana una lectura entre workspaces.

- **(a) Reutilizar `pf_maintenance`**, asumido con `SET LOCAL ROLE` solo en la transacción de la lectura, como ya hacen las purgas de idempotencia y del outbox. `pf_maintenance` gana `SELECT` de cinco columnas (`id`, `workspace_id`, `requested_by`, `status`, `expires_at`) y la política solo le muestra los `READY` vencidos; sin escritura ni clave envuelta. Es lo que ADR-0023 prevé para los jobs de mantenimiento entre workspaces.
- **(b) Un rol nuevo `pf_export_retention`** con los mismos grants y la misma política. Aísla mejor (un rol por job), pero suma un rol que mantener (migración, grants, docs/12) para el mismo patrón.
- **(c) Recorrer los workspaces con contexto** (una transacción por workspace). No suma lecturas sin contexto en `iam.workspace_export`, pero para listar los workspaces hay que leer `iam.workspace` entre workspaces (otra lectura de mantenimiento) y cada hora se ejecutan N transacciones.

**Recomendación: (a).** Es el patrón documentado en ADR-0023 y ya usado dos veces, y expone menos que hoy: ahora `pf_worker` ve sin contexto todas las columnas que tiene concedidas de los vencidos.

### 2. Cómo precisar en la spec el alcance de usuario de las claves de idempotencia

La tabla de claves guarda también claves de alcance de usuario (operaciones sin workspace, como crear un workspace). Con solo el usuario fijado, esas consultas tienen que seguir funcionando, aunque el requirement «Aislamiento fail-closed sin contexto de workspace» dice, en sentido estricto, que toda consulta sin workspace falla. Las tablas de usuario de `iam` ya funcionan así por ADR-0023, sin que la spec lo diga.

- **(a) Requirement ADDED propio** («Fail-closed de las claves de idempotencia sin contexto»): sin workspace ni usuario falla siempre; con solo el usuario expone solo las claves de ese usuario y ninguna de un workspace. El requirement general no cambia.
- **(b) MODIFIED del requirement general,** con una excepción para todas las tablas de alcance de usuario (claves, workspaces, membresías, usuarios, importaciones y cargas demo).
- **(c) No precisar la spec** y dejarlo solo en el design.

**Recomendación: (a)** (es lo que trae el delta). Precisa solo lo que este change toca y no reabre el requirement general, que D298 dejó sin cambios. La opción (b) es más completa, pero conviene hacerla en un change propio si el owner quiere documentar todas las tablas de usuario.

### 3. Alcance de la matriz del rol del worker

TC-SECURITY-RLS-017 recorre sin contexto todas las tablas registradas con `pf_worker`. Algunas lecturas son entre workspaces por diseño: el relay del outbox, el inbox (sin RLS, sin datos de negocio) y el dead-letter. Hay que decidir cómo tratarlas.

- **(a) Lista declarada en el test** (lecturas de outbox, inbox y dead-letter) y fallo ante cualquier otra lectura sin `PF002` ni `42501`. Ampliar la lista exige cambiar el test y el requirement.
- **(b) Matriz del worker solo informativa** (lista los casos sin fallar).
- **(c) Sin matriz del worker,** solo la de `pf_app`.

**Recomendación: (a).** El hueco de `iam.workspace_export` estaba justamente en una política del worker, y la matriz de `pf_app` no lo habría visto sin `ws_isolation`. La lista es corta y estable.

## Efecto en el orden

El change se puede empezar por los grupos 1 y 2 (TC y pruebas en rojo) sin esperar respuestas. El grupo 3 espera la pregunta 1. Las preguntas 2 y 3 no bloquean: si el owner elige otra opción, se ajustan el delta y los TC antes de fusionar.

## Decisiones del owner (2026-10-28)

| ID | Pregunta | Decisión |
|---|---|---|
| D308 | 1. Rol con el que el barrido de retención lee los exports vencidos | **`pf_maintenance`**, con `USAGE` sobre `iam` y `SELECT` de las cinco columnas que necesita (sin `wrapped_key` ni `object_key`); `PgExportRepository.findExpired` hace `SET LOCAL ROLE pf_maintenance`, como las purgas (ADR-0023). Desbloquea el grupo 3. |
| D309 | 2. Cómo precisar en la spec el alcance de usuario de las claves de idempotencia | **Requirement ADDED propio**, el que ya trae el delta. |
| D310 | 3. Matriz del worker | **Lista declarada** (outbox, inbox, dead-letter) y fallo ante cualquier otra lectura sin contexto. |
