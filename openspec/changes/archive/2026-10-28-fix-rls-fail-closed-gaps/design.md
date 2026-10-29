# Diseño: fix-rls-fail-closed-gaps

## Contexto

Las tablas de negocio tienen RLS habilitada y forzada (ADR-0023, NFR-SEC-003). La forma vigente de las políticas, que D298 conserva, es `workspace_id = platform.current_workspace_id()`. `platform.current_workspace_id()` (migración `20261002130000_platform_idempotency_key.sql`) es plpgsql `STABLE PARALLEL SAFE`: lee `app.workspace_id` y, si está vacío o no existe, lanza `PF002` (D19).

### Por qué la forma vigente falla siempre sin contexto

Que la forma vigente lance `PF002` incluso sobre una tabla vacía no depende de las filas sino del planner:

1. **Al planificar.** La comparación `columna = función()` es una restricción de la forma «variable = expresión». Para estimar su selectividad, PostgreSQL (`eqsel` → `get_restriction_variable` → `estimate_expression_value`) evalúa las funciones `STABLE` sin argumentos variables para obtener una constante. Esa evaluación ejecuta `current_workspace_id()`, que lanza `PF002` antes de leer una sola fila. Vale para las lecturas sin filtro y para las tablas vacías.
2. **Al ejecutar.** Si la consulta filtra además por `workspace_id = $1`, el planner deriva `$1 = current_workspace_id()` de la clase de equivalencia y lo ejecuta una vez como `One-Time Filter` en un nodo `Result` (el mismo nodo que motivó el change 49), antes de recorrer la tabla.

En los dos casos, el error no depende de que haya filas. Una política cuya expresión no tenga esa forma solo se evalúa fila por fila: sin filas que recorrer no lanza nada y la consulta devuelve vacío. Ese es el hueco.

### Causa exacta por tabla

**`platform.idempotency_key`** (migración `20261002130000_platform_idempotency_key.sql`). La política `idempotency_key_scope` para `pf_app` es:

```sql
USING (CASE WHEN workspace_id IS NULL THEN user_id = platform.current_user_id()
            ELSE workspace_id = platform.current_workspace_id() END)
```

El `CASE` existe porque la tabla guarda claves de dos alcances: de workspace (`workspace_id` no nulo, `scope_id = workspace_id`) y de usuario (operaciones sin workspace, como crear un workspace: `workspace_id` nulo, `scope_id = user_id`), y garantiza el orden de evaluación: una fila de usuario nunca exige el workspace. Pero un `CASE` no es una restricción «variable = expresión»: el planner le asigna una selectividad por omisión sin evaluar las funciones, no hay clase de equivalencia y ninguna función se evalúa al planificar. Solo se evalúa por cada fila que pasa los demás filtros:

- **Lectura filtrada** (`WHERE workspace_id = <W1>`): el filtro barato se aplica primero (el planner ordena los filtros por costo y el `CASE` con funciones plpgsql es el más caro); como W1 no tiene claves en la matriz, ninguna fila llega al `CASE` y la consulta devuelve vacío sin `PF002`. **Hallazgo de la matriz.**
- **Lectura sin filtro**: lanzó `PF002` en la matriz solo porque había filas de otras pruebas en la tabla. Con la tabla vacía devolvería vacío sin `PF002`: el resultado depende de los datos, y es el mismo hueco.

**`iam.workspace_export`** (migración `20261009010000_identity_workspace_export.sql`). La política `ws_isolation` para `pf_app` es:

```sql
USING (workspace_id = platform.current_workspace_id_if_set())
WITH CHECK (workspace_id = platform.current_workspace_id_if_set())
```

`current_workspace_id_if_set()` (migración `20261002150000_platform_roles_bff_worker.sql`) es una función SQL que devuelve `NULL` sin contexto y **nunca lanza**. El comentario de esa migración la reserva a las políticas de las tablas de usuario de `iam` que además exigen `current_user_id()`. Aquí se usó a propósito en una tabla de workspace: el barrido de retención `identity.export-retention` lee los exports vencidos de todos los workspaces sin contexto (`WorkspaceExportService.expireDue` → `uow.run({ userId: null, workspaceId: null })` → `PgExportRepository.findExpired`), con el rol `pf_worker`, por la política `retention_scan` (`FOR SELECT TO pf_worker USING (status = 'READY' AND expires_at < now())`). Como `pf_worker` hereda de `pf_app`, las dos políticas permisivas se combinan con `OR`. Si `ws_isolation` lanzara `PF002` al planificar, el barrido fallaría. Sin contexto, `workspace_id = NULL` nunca es verdadero: la lectura (filtrada o no) devuelve vacío sin `PF002` para `pf_app`. **Hallazgo de la matriz en las dos lecturas**, que no depende de los datos.

### Inventario: ¿hay otras tablas con el mismo patrón?

Se revisaron todas las sentencias `CREATE POLICY` de las secciones `migrate:up` de `apps/api/db/migrations/` hasta `20261019100100` (incluidas las que se generan con `format(...)`), y no solo las dos tablas de la matriz. Se clasificaron por la forma de la expresión y por el rol:

| Clase | Políticas | ¿Fail-closed sin contexto? |
|---|---|---|
| Forma vigente `workspace_id = current_workspace_id()` (USING y/o WITH CHECK), sola o en un `AND` con otras condiciones (`notifications.*` con `is_row_user` o `current_user_id()`, `notification_delivery` con `EXISTS`) o en un `OR` cuyos brazos se estiman todos (`fx.exchange_rate`: `workspace_id IS NULL OR …`) Las 125 de D298, de `pf_app` y `pf_worker` | Sí, al planificar |
| `CASE` evaluado fila por fila | `platform.idempotency_key.idempotency_key_scope` | **No** (hallazgo) |
| `current_workspace_id_if_set()` como única condición de workspace | `iam.workspace_export.ws_isolation` | **No** (hallazgo) |
| `current_workspace_id_if_set()` combinado con `current_user_id()` (tablas de usuario) | `iam.workspace.workspace_member_read`, `iam.workspace_membership.membership_read` | Sí sin usuario; con solo el usuario devuelven sus filas por diseño (ADR-0023: «políticas específicas por `user_id`») |
| Solo `current_user_id()` | `iam."user"`, `iam.workspace_import`, `platform.demo_workspace_run` | Sí sin usuario; con solo el usuario, sus filas por diseño (`demo_workspace_run`: ADR-0026) |
| `USING (true)` de `pf_worker` | `platform.outbox` (relay), `platform.dead_letter`, `fx.provider_run`, `fx.provider_history_point` | Entre workspaces por diseño (relay y tablas globales); `pf_app` no tiene `SELECT` en outbox ni en dead-letter |
| Sin RLS, solo `pf_worker` | `platform.inbox` (eventos procesados por consumidor, sin datos de negocio) | Entre workspaces por diseño; `pf_app` no tiene grants |
| Roles de mantenimiento y del dueño | `pf_maintenance`, `pf_ledger_maintenance`, `pf_workspace_directory`, `demo_purge_*`, sondas con GUC propias | No son `pf_app` ni `pf_worker`; se asumen con `SET LOCAL ROLE` o en funciones `SECURITY DEFINER` acotadas |

Las únicas políticas de `pf_app` o `pf_worker` sobre tablas registradas en `platform.workspace_scoped_table` que no lanzan `PF002` sin contexto son las dos de la matriz, sin contar la infraestructura de eventos de `pf_worker`, que es entre workspaces por diseño (outbox, inbox y dead-letter). Es la misma conclusión que dio la matriz de #162, que como `pf_app` recorre todas las tablas registradas (todas las que tienen `workspace_id`, por el test de catálogo). El inventario agrega dos cosas que la matriz no veía: que en `idempotency_key` también la lectura sin filtro depende de los datos, y que `pf_worker` no se recorría.

Decisiones del owner que se aplican:

| Decisión | Origen | Aplicación |
|---|---|---|
| D296 | docs/48 | Un hueco de fail-closed previo se corrige en un change de seguridad aparte, con diseño propio (este change) |
| D298 | docs/49 | No se migran ni reescriben las políticas de la forma vigente; la corrección solo toca las dos que no cumplen y adopta esa forma |
| D19 | docs/31 | Sin contexto, la consulta falla con `PF002`; nunca 0 filas |
| D43 | docs/31 | Se mantiene el fail-closed; no se evalúan reescrituras que lo debiliten |
| ADR-0023 | docs/adr | Los jobs de mantenimiento entre workspaces usan `pf_maintenance` o iteran por workspace con contexto |

## Objetivos / No objetivos

**Objetivos**

- Que `platform.idempotency_key` e `iam.workspace_export` lancen `PF002` sin contexto en cualquier lectura o escritura, también con la tabla vacía o con un filtro que no encuentra filas.
- Conservar las claves de idempotencia de alcance de usuario y el barrido de retención de exports, sin cambios observables en la API.
- Convertir la matriz de TC-SECURITY-RLS-007 en un gate que falle ante cualquier vacío sin `PF002`, cubrir también al rol del worker y evitar que vuelva a usarse `current_workspace_id_if_set()` en una tabla de workspace.

**No objetivos**

- Cambiar la forma de las políticas que ya cumplen (D298) o el benchmark de RLS.
- Cambiar las tablas de alcance de usuario ni el relay del outbox.
- Cambiar los SQLSTATE, los códigos de error de la API o el contrato.

## Decisiones

### 1. `platform.idempotency_key`: conjunto previo plegable al planificar

Función nueva, plpgsql `STABLE PARALLEL SAFE`, con `REVOKE ALL … FROM PUBLIC` y `GRANT EXECUTE … TO pf_app`:

```sql
CREATE FUNCTION platform.current_idempotency_scope_id() RETURNS uuid
  LANGUAGE plpgsql STABLE PARALLEL SAFE AS
$$
DECLARE ws text := current_setting('app.workspace_id', true);
        usr text := current_setting('app.user_id', true);
BEGIN
  IF ws IS NOT NULL AND ws <> '' THEN RETURN ws::uuid; END IF;
  IF usr IS NOT NULL AND usr <> '' THEN RETURN usr::uuid; END IF;
  RAISE EXCEPTION 'workspace context not set' USING ERRCODE = 'PF002';
END
$$;
```

La política se cambia con `ALTER POLICY` (mismo nombre, mismos roles), agregando ese conjunto delante del `CASE`, que se conserva sin cambios:

```sql
ALTER POLICY idempotency_key_scope ON platform.idempotency_key
  USING (scope_id = platform.current_idempotency_scope_id() AND <CASE vigente>)
  WITH CHECK (scope_id = platform.current_idempotency_scope_id() AND <CASE vigente>);
```

- **Por qué cierra el hueco:** `scope_id = función()` es una restricción «variable = expresión» y se evalúa al planificar, igual que la forma vigente. Sin workspace ni usuario, la función lanza `PF002` antes de leer filas, con la tabla vacía o con cualquier filtro.
- **Por qué no rompe el alcance de usuario:** `applyRlsContext` fija siempre `app.user_id` y fija `app.workspace_id` solo cuando la operación es de un workspace. `scopeIdOf` usa la misma regla (`workspaceId ?? userId`), así que la función devuelve justo el `scope_id` con el que el store busca, inserta, actualiza y borra.
- **Por qué se conserva el `CASE`:** defensa en profundidad. Mantiene la exigencia de que una fila de usuario sea del usuario fijado y de que una fila de workspace sea del workspace fijado, aunque el `CHECK idempotency_key_scope` ya ate `scope_id` a `coalesce(workspace_id, user_id)`.
- **Efecto colateral aceptado:** con contexto de workspace, la transacción ya no ve las claves de alcance de usuario del mismo usuario (antes el `CASE` las mostraba). Ninguna consulta de la aplicación las busca así, porque todas filtran por `scope_id`.
- **Con solo el usuario fijado,** una lectura filtrada por un workspace devuelve vacío sin `PF002`. No es un hueco: sin workspace fijado no se alcanza ninguna fila de un workspace (el conjunto limita a `scope_id = <usuario>`), y es el alcance de usuario por diseño (requirement ADDED «Fail-closed de las claves de idempotencia sin contexto»).
- **Alternativa descartada:** `workspace_id = current_workspace_id() OR (workspace_id IS NULL AND user_id = current_user_id())`. El planner estima los dos brazos del `OR`, así que el primero lanza `PF002` siempre que no haya workspace, también en las operaciones legítimas de alcance de usuario (`POST /workspaces`).
- **Alternativa descartada:** separar las claves de usuario en otra tabla. Cambia la estructura y el store por un problema que una sola condición resuelve.

### 2. `iam.workspace_export`: forma vigente y barrido con `pf_maintenance`

```sql
ALTER POLICY ws_isolation ON iam.workspace_export
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
ALTER POLICY retention_scan ON iam.workspace_export TO pf_maintenance;  -- USING sin cambios
GRANT USAGE ON SCHEMA iam TO pf_maintenance;
GRANT SELECT (id, workspace_id, requested_by, status, expires_at) ON iam.workspace_export TO pf_maintenance;
```

- `ws_isolation` adopta la forma vigente, sin variantes nuevas (D298).
- El barrido lee con `pf_maintenance`, asumido solo en la transacción de la lectura: `PgExportRepository.findExpired` ejecuta `SET LOCAL ROLE pf_maintenance` antes del `SELECT`. `pf_worker` ya tiene `GRANT pf_maintenance … WITH INHERIT FALSE, SET TRUE` (migración `20261003120000_platform_event_outbox.sql`), y lo usan las purgas de idempotencia (`PgIdempotencyStore`) y del outbox (`platform/src/events/purge.ts`). `pf_maintenance` no es miembro de `pf_app`, así que bajo ese rol `ws_isolation` no aplica y solo rige `retention_scan`: solo los `READY` vencidos y solo cinco columnas (sin `object_key`, `key_id` ni `wrapped_key`). Sin `UPDATE` ni `INSERT`.
- La expiración de cada export sigue igual: una transacción por export con el contexto de su workspace y su solicitante (`uow.run({ userId: ref.requestedBy, workspaceId: ref.workspaceId })`), con `ws_isolation` y la auditoría en la misma unidad de trabajo.
- Sin contexto, `pf_worker` (que hereda `ws_isolation`) y `pf_app` fallan con `PF002`.
- **Alternativa descartada:** recorrer los workspaces con contexto. Para listar los workspaces hay que leer `iam.workspace` entre workspaces, que es otra lectura de mantenimiento, y suma N transacciones por hora sin ganar aislamiento.
- **Alternativa descartada:** un rol nuevo `pf_export_retention`. Es un rol más que mantener (grants, `pg_hba`, documentación) para el mismo patrón que ADR-0023 asigna a `pf_maintenance`. Queda como opción en la pregunta 1 de [docs/55](../../../docs/55-rls-fail-closed-questions.md).

### 3. Verificación (requirement MODIFIED)

- **TC-SECURITY-RLS-007:** la matriz conserva su bloque `RLS-FAIL-CLOSED-MATRIX` y sus `RLS-FAIL-CLOSED-FINDING`, pero el test falla si hay algún hallazgo (`expect(findings).toEqual([])`). Para que el resultado no dependa de los datos, en la misma transacción revertida el superusuario borra antes las filas de `platform.idempotency_key` e `iam.workspace_export` (las dos con evaluación por fila hasta hoy), con `session_replication_role = 'replica'` para no disparar triggers.
- **TC-SECURITY-RLS-017:** la misma matriz con `SET LOCAL ROLE pf_worker` y una lista declarada en el test de políticas de `pf_worker` entre workspaces por diseño: lectura de `platform.outbox` (relay), `platform.inbox` y `platform.dead_letter`, la infraestructura de entrega de eventos. Cualquier otra lectura sin contexto que no lance `PF002` (o `42501` por falta de grant) hace fallar el test. Ampliar la lista exige cambiar el test y este requirement.
- **TC-SECURITY-RLS-018:** regla de catálogo sobre `pg_policies`: las políticas de `pf_app` o `pf_worker` que mencionan `current_workspace_id_if_set` deben ser exactamente `iam.workspace.workspace_member_read` e `iam.workspace_membership.membership_read`, y las dos deben exigir también `current_user_id()`. No reintroduce la «forma canónica» descartada por D298: no exige una forma, solo prohíbe la variante tolerante en tablas de workspace.

### Capas afectadas

| Elemento | Capa | Cambio |
|---|---|---|
| `apps/api/db/migrations/<timestamp>_platform_rls_fail_closed_gaps.sql` | infraestructura (BD) | Función, dos `ALTER POLICY`, reasignación de `retention_scan` y grants a `pf_maintenance` |
| `packages/contexts/identity/src/infrastructure/portability/pg-portability.ts` | infraestructura | `findExpired`: `SET LOCAL ROLE pf_maintenance` y comentario |
| `packages/contexts/identity/src/application/portability/workspace-export.service.ts` | aplicación | Solo el comentario de `expireDue` (cita el rol de mantenimiento); sin cambio de lógica |
| `apps/api/test/db/rls-isolation.int.test.ts` | pruebas | TC-SECURITY-RLS-007 estricto, 013, 015, 016, 017 y 018 |
| `apps/api/test/db/idempotency-key.int.test.ts` | pruebas | TC-SECURITY-RLS-014 y el catálogo de políticas de la tabla (mismos nombres) |

Sin cambios en el dominio, la API, la UI, los eventos ni la portabilidad: las dos tablas ya están excluidas del export (`identity/src/contracts/portability.ts`). La purga del workspace demo (`platform.purge_demo_workspace`, `SECURITY DEFINER` con las políticas `demo_purge_*` del dueño) no pasa por las políticas de `pf_app` y no cambia. Las purgas por retención de idempotencia (`pf_maintenance`, `expires_at < now()`) tampoco cambian.

### Rendimiento

- `idempotency_key`: las consultas del store filtran por `scope_id = $1 AND key = $2` (clave primaria). El conjunto nuevo forma clase de equivalencia con `scope_id = $1` y se ejecuta una vez por sentencia como `One-Time Filter`, más una evaluación al planificar. Son microsegundos sobre una búsqueda por clave primaria, sin cambio de plan esperado. No hay fila de benchmark para esta tabla.
- `workspace_export`: pasa a la forma vigente, la misma de las 125 políticas medidas. La tabla tiene pocas filas por workspace y sus consultas filtran por `workspace_id`.
- El benchmark de RLS (`nightly.perf.ts`) no cambia: las tablas del ledger y de cuentas no se tocan.

## Contratos

Ninguno. Sin cambios en `contracts/openapi` (oasdiff limpio), en `ErrorCode` ni en `contracts/events`. `PF002` sigue traduciéndose como hoy (D19).

## Riesgos / Trade-offs

- **El fail-closed de las lecturas sin filtro depende del planner.** Que una tabla vacía lance `PF002` depende de que PostgreSQL evalúe la función al estimar la selectividad. Es el mismo mecanismo que ya protege a las 125 políticas vigentes. Mitigación: la matriz lo verifica con las tablas vacías en cada corrida de `integration` (PostgreSQL 18) y falla si deja de ocurrir, por ejemplo al subir de versión.
- **Planes genéricos de sentencias preparadas con nombre.** Un plan genérico en caché no se vuelve a estimar, y una lectura sin filtro sobre una tabla vacía podría devolver vacío. Hoy la aplicación no usa sentencias con nombre (`pg` sin `name`); la tarea 3.3 lo verifica y deja una nota en ADR-0023. Afecta por igual a la forma vigente y no lo introduce este change.
- **Orden de despliegue.** Si la migración se aplica antes que el worker nuevo, el barrido de retención falla con `PF002` hasta que el worker se actualiza y reintenta en la hora siguiente. La descarga ya responde 410 `EXPORT_EXPIRED` por `expires_at`, así que no hay exposición. La migración y el código van en el mismo PR, así que la ventana dura como mucho lo que tarde en desplegarse el worker (una corrida del barrido).
- **Lectura entre workspaces de `pf_maintenance`.** Gana `SELECT` de cinco columnas de `iam.workspace_export`, limitado por la política a los `READY` vencidos, sin `wrapped_key` ni `object_key`. Es menos de lo que hoy ve `pf_worker` sin contexto (todas las columnas que tiene concedidas).
- **Claves de usuario invisibles con contexto de workspace.** Ver la decisión 1. Si en el futuro una operación necesitara las dos, tendría que consultar en dos transacciones (una por alcance).

## Plan de migración

1. Migración expand `<timestamp>_platform_rls_fail_closed_gaps.sql` con `pf_migrator`, con un timestamp posterior a la última de `main` en el momento de implementar. Sin backfill ni cambios de estructura.
2. `migrate:down`: `ALTER POLICY` de vuelta a las expresiones anteriores (copiadas de las migraciones `20261002130000` y `20261009010000`), `ALTER POLICY retention_scan … TO pf_worker`, `REVOKE` de los grants de `pf_maintenance` y `DROP FUNCTION platform.current_idempotency_scope_id()`. El `down` reabre el hueco y solo se usa para revertir el despliegue.
3. Código del worker (`findExpired`) en el mismo PR.
4. Verificación: `pnpm test:integration` dos veces seguidas en verde (TC-SECURITY-RLS-001..007, 013..018, TC-SECURITY-ISOLATION-001, TC-IDENTITY-EXPORT-007 y los de idempotencia) y `pnpm test:stack` (migración desde cero y `down`/`up`).

## Preguntas abiertas

En [docs/55](../../../docs/55-rls-fail-closed-questions.md). La pregunta 1 (rol del barrido de retención) bloquea el grupo 3 (migración y worker); el diseño adopta su recomendación (`pf_maintenance`). Las preguntas 2 y 3 no bloquean.
