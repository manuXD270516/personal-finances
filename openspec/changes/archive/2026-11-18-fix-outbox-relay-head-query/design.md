# Diseño: fix-outbox-relay-head-query

## Contexto

`OutboxRelay.runOnce` abre una transacción, toma el advisory lock `OUTBOX_RELAY_LOCK_KEY` (una sola réplica publica), selecciona hasta `batchSize` (200) cabezas pendientes, las encola en pg-boss sobre la misma conexión y marca `published_at` antes del `COMMIT`. Publicar solo la cabeza de cada `(workspace_id, aggregate_id)` por lote es lo que mantiene el orden por agregado en la cola (pg-boss desempata por `(created_on, id)` dentro de una misma transacción; TC-PLATFORM-EVENTS-013).

Índices relevantes de `platform.outbox` (`sequence` es `GENERATED ALWAYS AS IDENTITY UNIQUE`):

- `outbox_pending_idx (sequence) WHERE published_at IS NULL` (migración `20261003120000`).
- `outbox_pending_aggregate_idx (workspace_id, aggregate_id, sequence) WHERE published_at IS NULL` (migración `20261003150000`).

Consulta actual:

```sql
SELECT o.id, o.event_type, o.event_version, o.aggregate_id, o.correlation_id, o.envelope, o.trace_context
  FROM platform.outbox o
 WHERE o.published_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM platform.outbox p
                    WHERE p.published_at IS NULL
                      AND p.workspace_id = o.workspace_id
                      AND p.aggregate_id = o.aggregate_id
                      AND p.sequence < o.sequence)
 ORDER BY o.sequence
 LIMIT $1
 FOR UPDATE OF o SKIP LOCKED
```

## Causa

El `NOT EXISTS` se transforma en un anti join que el planner puede resolver de varias formas. Con estadísticas que dicen que `published_at IS NULL` casi no ocurre (análisis tomado con el outbox vacío o recién purgado; una ráfaga de ~13 000 filas no alcanza el umbral de autoanalyze de una tabla grande de publicados), la estimación del índice parcial es `rows=1` y el plan elegido es Nested Loop Anti Join con el lado interno sobre el índice parcial y un Join Filter con `workspace_id` y `aggregate_id`: por cada fila externa se recorren todos los pendientes. El costo de un lote es cuadrático en los pendientes; las entradas muertas del índice parcial (filas ya publicadas aún no limpiadas) lo empeoran. Con buenas estadísticas el planner elige un hash anti join y el problema no aparece, por eso solo se ve tras períodos tranquilos o purgas.

## Decisión

> Reemplazada por la sección «Corrección en la implementación» (más abajo): la consulta final usa `DISTINCT ON` en un InitPlan, no la subconsulta escalar de la decisión 1; las secciones 1 a 3 quedan como registro del razonamiento original.

### 1. Subconsulta escalar por agregado

```sql
SELECT o.id, o.event_type, o.event_version, o.aggregate_id, o.correlation_id, o.envelope, o.trace_context
  FROM platform.outbox o
 WHERE o.published_at IS NULL
   AND o.sequence = (SELECT p.sequence
                       FROM platform.outbox p
                      WHERE p.published_at IS NULL
                        AND p.workspace_id = o.workspace_id
                        AND p.aggregate_id = o.aggregate_id
                      ORDER BY p.sequence
                      LIMIT 1)
 ORDER BY o.sequence
 LIMIT $1
 FOR UPDATE OF o SKIP LOCKED
```

PostgreSQL no aplana una subconsulta escalar correlacionada con `LIMIT`: queda como SubPlan evaluado por fila externa, con `Limit` sobre un Index Scan / Index Only Scan de `outbox_pending_aggregate_idx` por la igualdad de `(workspace_id, aggregate_id)` y el orden de `sequence` del índice. Ese acceso cuesta O(log n) más las entradas muertas del propio agregado, cualquiera sea la estimación de filas. El lado externo recorre los pendientes por `sequence` (normalmente `outbox_pending_idx`) y se detiene al juntar `$1` cabezas.

La consulta queda en una constante exportada de `@pf/platform/events` (nombre sugerido `OUTBOX_RELAY_HEADS_SQL`) que usan `runOnce`, los tests de integración (TC-PLATFORM-EVENTS-022 hace `EXPLAIN` de esa constante) y `diagnoseOutbox` del nightly, que hoy tiene una copia (`RELAY_HEADS_QUERY` en `apps/api/test/perf/persist-instrumentation.ts`).

### 2. Equivalencia con la consulta actual

- Una fila pendiente es cabeza si y solo si su `sequence` es el mínimo de los pendientes de su `(workspace_id, aggregate_id)`. El `NOT EXISTS` lo expresa como «no hay uno menor»; la subconsulta, como «es igual al menor». Con `sequence` único las dos son la misma condición.
- Ambas se evalúan con la instantánea de la sentencia (READ COMMITTED) y sin bloquear las filas de `p`: una cabeza bloqueada por otra transacción sigue contando como pendiente, así que su sucesor no se selecciona; `SKIP LOCKED` solo salta la cabeza bloqueada (TC-PLATFORM-EVENTS-021). Si la cabeza cambia entre la lectura y el bloqueo, la recomprobación de `FOR UPDATE` reevalúa el filtro completo, igual que hoy.
- El orden (`ORDER BY o.sequence`), el tope (`LIMIT $1`), el bloqueo (`FOR UPDATE OF o`) y el resto de `runOnce` (lock, encolado, marcado, registro de fallos, métricas) no cambian.

### 3. Costo en el peor caso

El recorrido externo examina cada pendiente hasta juntar `batchSize` cabezas. El primer pendiente por `sequence` siempre es cabeza; si un agregado acapara el backlog, el recorrido puede llegar a todos los pendientes de un lote, pero cada uno paga un acceso por índice acotado: casi lineal (O(n log n)), no cuadrático. Si el planner prefiriera un Seq Scan con Sort externo, el SubPlan sigue siendo por índice y la cota se mantiene.

## Corrección en la implementación (2026-11-17)

La decisión 1 (subconsulta escalar) NO cumplió su premisa. Con el procedimiento de TC-PLATFORM-EVENTS-022 (estadísticas con 5 000 publicados y ningún pendiente, luego 10 000 pendientes), el planner estima `rows=1` tanto para `outbox_pending_idx` como para `outbox_pending_aggregate_idx` y, con costos empatados, el SubPlan eligió `outbox_pending_idx` con Filter por `workspace_id`/`aggregate_id` (≈ 500 entradas descartadas por fila externa): 117 ms para 200 cabezas frente a 367 ms de la consulta anterior, es decir, el mismo defecto cuadrático con otra constante. Variantes probadas y descartadas con el mismo resultado: `min(p.sequence)`, `ORDER BY p.sequence + 0`, rangos sobre `aggregate_id` con `ORDER BY workspace_id, aggregate_id, sequence` (hasta 680 ms).

Decisión final: `SELECT ... WHERE published_at IS NULL AND id = ANY(ARRAY(SELECT DISTINCT ON (workspace_id, aggregate_id) id ... ORDER BY workspace_id, aggregate_id, sequence)) ORDER BY sequence LIMIT $1 FOR UPDATE OF o SKIP LOCKED`. Las cabezas se calculan una sola vez por lote (InitPlan), de modo que ningún plan posible evalúa algo por cada pendiente: 7 ms con 8 000 pendientes con estadísticas viejas y 5 ms con estadísticas frescas, ambos casos O(n log n). El bloqueo se aplica solo a `o` (arriba), así que `DISTINCT ON` no choca con `FOR UPDATE`. Costo asumido: cada lote lee todos los pendientes aunque publique 200. La semántica (equivalencia, cabeza bloqueada) no cambia; TC-PLATFORM-EVENTS-020 y -021 lo verifican, y TC-022 afirma el plan nuevo (sin anti join, sin Join Filter, sin SubPlan por fila, InitPlan con `Unique`) y el tope de tiempo.

## Alternativas evaluadas

| Alternativa | Resultado |
| --- | --- |
| Subconsulta escalar (primera elección; descartada en la implementación, ver «Corrección») | Plan estable con estadísticas buenas o malas; sin migración. 86 ms frente a > 120 s en la reproducción, pero sigue evaluando un SubPlan por cada pendiente. Reemplazada por la elegida. |
| `DISTINCT ON (workspace_id, aggregate_id)` en un InitPlan (`id = ANY(ARRAY(...))`) con `FOR UPDATE OF o` sobre la consulta externa | **Elegida** (ver «Corrección en la implementación»). Lee y ordena todos los pendientes en cada lote (O(n log n)), costo asumido. El bloqueo se aplica solo a `o`, así que no choca con `DISTINCT ON`; la objeción original (`FOR UPDATE` incompatible con `DISTINCT`) solo aplicaba a ponerlo en la misma sentencia que el bloqueo. `row_number()` queda descartada por el mismo costo sin ventaja. |
| CTE recursivo de recorrido salteado por el índice de agregados | Mismo efecto que la elegida con más complejidad; el orden global por `sequence` exigiría un paso más. Descartada. |
| Desactivar el nested loop con `SET LOCAL enable_nestloop = off` | Depende de detalles del planner, castiga otros planes de la transacción y no corrige la estimación. Descartada. |
| `ANALYZE platform.outbox` desde el relay o el harness | El relay correría mantenimiento en cada ráfaga y el harness solo taparía el síntoma en CI; producción seguiría expuesta. Descartada. |
| Parámetros de autoanalyze más agresivos en `platform.outbox` (`ALTER TABLE … SET (autovacuum_analyze_scale_factor …)`) | Achica la ventana pero no la cierra (el autovacuum despierta cada `autovacuum_naptime` y una ráfaga confirma antes). No hace falta con la consulta nueva; queda solo como recurso de `stabilize-import-persist-perf` (tarea 7.4) si P6 lo justifica, en una migración expand aparte. No se incluye. |
| Índice nuevo | No hace falta: `outbox_pending_aggregate_idx` ya sirve a la subconsulta y `outbox_pending_idx` al recorrido externo. No se toca ningún índice. |

## Contratos

Sin cambios: ni OpenAPI, ni eventos, ni `ErrorCode`, ni tablas, índices o migraciones. La única superficie nueva es la constante exportada de `@pf/platform/events` (interna del monorepo, `pnpm arch:check` la permite porque `apps/api` ya importa de ese subpaquete).

## Pruebas

En `apps/api/test/events/event-delivery.int.test.ts` (PostgreSQL 18.6 real, `pf_worker` y `pf_migrator` como hoy; archivo nuevo en el mismo directorio si conviene aislar los datos sintéticos):

- **TC-PLATFORM-EVENTS-020 (equivalencia).** Pendientes intercalados de varios agregados en dos workspaces, con un `aggregate_id` repetido en ambos; relay con `batchSize` pequeño y rutas vacías o una cola real. Se compara cada lote con la selección de referencia calculada en el test (mínimo `sequence` por `(workspace_id, aggregate_id)`, orden por `sequence`, primeros `batchSize`) y se verifica que ningún sucesor sale en el mismo lote que su cabeza. Para dar rojo/verde en el mismo test conviene evaluar también la consulta anterior como referencia literal dentro de una transacción revertida.
- **TC-PLATFORM-EVENTS-021 (cabeza bloqueada).** Otra conexión toma `SELECT … FOR UPDATE` sobre la cabeza de un agregado; un lote del relay no publica esa cabeza ni sus sucesores y sí las cabezas de los demás; al liberar el bloqueo, el siguiente lote publica la cabeza y el posterior su sucesor.
- **TC-PLATFORM-EVENTS-022 (estadísticas desactualizadas).** Todo dentro de UNA transacción revertida con `pf_migrator` (o el rol dueño de la tabla), para no dejar filas ni estadísticas en la base compartida y para que el autoanalyze no pueda cambiar las estadísticas a mitad del test (`ANALYZE` toma `SHARE UPDATE EXCLUSIVE` hasta el final de la transacción):
  1. Insertar 5 000 eventos sintéticos ya publicados de un workspace propio (historia) y ejecutar `ANALYZE platform.outbox` (estadísticas con casi ningún pendiente).
  2. Insertar 10 000 pendientes de 2 000 agregados, 5 consecutivos por agregado (cabezas dispersas: el peor caso del anti join), y marcar publicados 2 000 de ellos para dejar entradas muertas en el índice parcial.
  3. `EXPLAIN (FORMAT JSON)` de `OUTBOX_RELAY_HEADS_SQL` con `$1 = 200`: el plan NO DEBE tener un nodo de anti join sobre `platform.outbox`, ni un Join Filter que compare `workspace_id`/`aggregate_id`, ni un SubPlan evaluado por fila; DEBE tener un InitPlan con un nodo `Unique` (el `DISTINCT ON`). (Redacción original, superada por la «Corrección»: un SubPlan con Index Scan de `outbox_pending_aggregate_idx` bajo un `Limit`.)
  4. `EXPLAIN (ANALYZE, FORMAT JSON)` de la misma consulta: devuelve 200 filas, todas cabezas, y `Execution Time` ≤ 5 000 ms (tope holgado: la consulta nueva tarda decenas de milisegundos; la anterior, segundos o más con este volumen).
  5. `ROLLBACK`.

  Rojo previo: en `main` (consulta con `NOT EXISTS`) el paso 3 debe mostrar el anti join con Join Filter. Si en el entorno de CI la estimación no reproduce el plan malo con este procedimiento, fijar las estadísticas con `pg_restore_relation_stats` / `pg_restore_attribute_stats` (PostgreSQL 18) dentro de la misma transacción (fracción nula de `published_at` = 0 y `reltuples` de la historia) y anotarlo en la tarea 2.3. La aserción de plan de la consulta nueva no depende de las estimaciones y es la que protege la regresión; el tope de tiempo es una red secundaria.

- **Regresión:** TC-PLATFORM-EVENTS-013 (cabeza antes que sucesores tras caída de la cola) y el resto de `event-delivery.int.test.ts` y `event-throughput.int.test.ts` sin cambios.
- **Punta a punta:** nightly (`imports.perf.ts`, drenado ≤ 120 s de la fila del host; `throughput.perf.ts`, fase A completa) sin tocar presupuestos; se dispara por `workflow_dispatch` desde la rama del fix antes de fusionar si el lead lo pide, o se observa en los programados siguientes.
