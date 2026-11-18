# Tareas

> Fix chico de plataforma. Sin migraciones, sin índices nuevos, sin cambios de contrato ni de configuración. Los tests de integración necesitan Docker; sin Docker los valida CI (`test:integration`).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar el delta de `platform/event-delivery` (1 ADDED, 3 scenarios) y `pnpm exec openspec validate fix-outbox-relay-head-query --strict` — 2026-11-17: `openspec validate --strict` en verde.
- [x] 1.2 Revisar TC-PLATFORM-EVENTS-020, -021 y -022 contra los scenarios; pasarlos a `ready` al empezar la implementación — 2026-11-17: TC a `automated` con la implementación.

## 2. PRUEBAS primero (rojo en `main`)

- [x] 2.1 Exportar la consulta actual de `runOnce` como constante de `@pf/platform/events` (sin cambiarla todavía) y usarla en `runOnce` y en `diagnoseOutbox` (`apps/api/test/perf/persist-instrumentation.ts`, en lugar de `RELAY_HEADS_QUERY`); `packages/platform` y `apps/api` en verde — 2026-11-17: constante `OUTBOX_RELAY_HEADS_SQL` en `relay.ts`, exportada de `@pf/platform/events` y usada por `runOnce` y `diagnoseOutbox` (con `$1 = 500`).
- [x] 2.2 `[TC-PLATFORM-EVENTS-020]` y `[TC-PLATFORM-EVENTS-021]` en `apps/api/test/events/event-delivery.int.test.ts` (o un archivo nuevo `relay-heads.int.test.ts` en el mismo directorio): equivalencia de la selección por lotes de 3 con dos workspaces y un agregado compartido, y cabeza bloqueada por otra conexión. Deben pasar ya con la consulta actual (son de equivalencia) — 2026-11-17: `apps/api/test/events/relay-heads.int.test.ts`; verdes con la consulta anterior y con la nueva (comparan además la consulta anterior literal con la referencia del test).
- [x] 2.3 `[TC-PLATFORM-EVENTS-022]` con el procedimiento del design (§Pruebas): transacción revertida, historia publicada + `ANALYZE`, 10 000 pendientes en 2 000 agregados con entradas muertas, `EXPLAIN (FORMAT JSON)` sin anti join ni Join Filter de agregado y con SubPlan sobre `outbox_pending_aggregate_idx`, y `EXPLAIN (ANALYZE)` ≤ 5 000 ms. Registrar el rojo con la consulta actual (plan con anti join); si el procedimiento no lo reproduce en el contenedor, fijar estadísticas con `pg_restore_relation_stats` / `pg_restore_attribute_stats` y anotarlo aquí. Timeout explícito del test (≥ 60 s, CI es más lento) — 2026-11-17: ROJO registrado con la consulta anterior (`NOT EXISTS`), procedimiento del design sin `pg_restore_*_stats` (reproduce solo): plan `Limit > LockRows > Nested Loop` con `Join Type: Anti`, `Join Filter: ((p.sequence < o.sequence) AND (p.workspace_id = o.workspace_id) AND (p.aggregate_id = o.aggregate_id))`, ambos lados `Index Scan using outbox_pending_idx` con `Plan Rows: 1`; `EXPLAIN ANALYZE` 367 ms (el test falló en la aserción de anti join). La subconsulta escalar del design también falló (SubPlan sobre `outbox_pending_idx`, 117 a 680 ms según la variante): ver design «Corrección en la implementación»; la consulta final usa `DISTINCT ON`.

## 3. IMPLEMENTACIÓN

- [x] 3.1 `packages/platform/src/events/relay.ts`: la constante pasa a la subconsulta escalar del design (§Decisión 1); actualizar el comentario de `runOnce` y el JSDoc de la clase. Sin tocar el advisory lock, el encolado, el marcado ni el registro de fallos. La migración `20261003150000` (fusionada) no se edita: la nota sobre qué consulta usa el índice va en el JSDoc de la constante — 2026-11-17: consulta final con `DISTINCT ON` en `ARRAY(...)` (desvío del design, documentado en él, la propuesta, el delta de spec y TC-022). La migración fusionada no se tocó; la nota va en el JSDoc de la constante.

## 4. TESTS AUTOMATIZADOS y regresión

- [x] 4.1 TC-PLATFORM-EVENTS-020, -021 y -022 en verde; TC-PLATFORM-EVENTS-013 y el resto de `event-delivery.int.test.ts` y `event-throughput.int.test.ts` sin cambios y en verde — 2026-11-17: `test:integration` completo en verde (ver 4.2).
- [x] 4.2 Gates: `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm traceability:check`, `pnpm spec:validate`, `pnpm config:docs:check`, `pnpm contract:breaking` (sin cambios esperados) y `pnpm test:integration` dos veces seguidas en verde
- [ ] 4.3 Nightly por `workflow_dispatch` desde la rama del fix (o los programados siguientes a la fusión): fila del drenado de `imports.perf.ts` ≤ 120 s y fase A de `throughput.perf.ts` completa, sin tocar presupuestos; registrar el resultado aquí y cerrar el issue #147 si corresponde — Pendiente tras la fusión (la corre la sesión principal con `workflow_dispatch` o los nightly siguientes); sin evidencia todavía.

## 5. DOCS y cierre

- [x] 5.1 TC-PLATFORM-EVENTS-020..022 a `automated` con sus `automated_tests`; `requirement_status: confirmed` al archivar — 2026-11-17: `automated` con `automated_tests`; `requirement_status: confirmed` al archivar.
- [x] 5.2 Nota en `stabilize-import-persist-perf/tasks.md` tarea 7.5 (H7 resuelta por este change, con el enlace al PR); `docs/38-estado-y-pendientes.md` lo actualiza la sesión principal — 2026-11-17: nota agregada en `stabilize-import-persist-perf/tasks.md` 7.5 con la rama `fix/outbox-relay-head-query` (el enlace al PR se completa al abrirlo); `docs/38` lo actualiza la sesión principal.
