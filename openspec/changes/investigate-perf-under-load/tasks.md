# Tareas

> Change de investigación: sin dominio, aplicación, API, UI ni migraciones. El entregable de implementación es un informe con la causa medida de cada rojo de `perf` y su camino; los arreglos del producto van en changes de seguimiento. Sin Docker, `pnpm perf:bench` no corre en la sesión: las mediciones las hace el job `perf` por `workflow_dispatch` (rama de experimentos) y se dice en el informe. El job `perf` sigue bloqueante mientras tanto (D285). Las preguntas de [docs/47](../../../docs/47-investigate-perf-under-load-questions.md) están resueltas ([docs/48](../../../docs/48-perf-and-rls-owner-decisions.md), 2026-10-23): aislamiento por purga del backlog residual (D291), fila de throughput con handler real informativa (D292) y runner estándar (D293). Ningún grupo espera al owner.
>
> **Orden de implementación.** (1) Grupo 1, sin Docker. (2) Grupos 2 y 6 en un PR que se fusiona: tests unitarios y de política escritos y verificados sin Docker (`pnpm turbo test`); la foto real de carga de fondo la valida el job `perf` por `workflow_dispatch`. (3) Grupo 3: experimentos solo por `workflow_dispatch` de `nightly` desde la rama `claude/investigate-perf-under-load-experiments`, que no se fusiona. (4) Grupo 4 (informe), sin Docker. (5) Grupo 5 con la purga de D291: tests del veredicto sin Docker; la purga y la precondición se verifican por `workflow_dispatch` (7.2). (6) Grupos 7 y 8.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar el delta de `platform/delivery-pipeline`; `pnpm exec openspec validate investigate-perf-under-load --strict` (2026-10-23: delta revisado contra los TC; el change valida con `--strict`)
- [x] 1.2 Revisar TC-PLATFORM-PIPELINE-024..028 contra los scenarios; pasarlos a `ready` al empezar la implementación (2026-10-23: revisados; los cinco pasaron a `status: ready`)

## 2. INSTRUMENTACIÓN del benchmark (decisión 2; se fusiona)

- [x] 2.1 Tests unitarios en `apps/api/test/perf/perf-report.test.ts`, escritos antes que el código (TDD): agregación de la foto de carga de fondo por suite y por benchmark, campo aditivo `backgroundLoad` en `perf-results.json`, tabla en `perf-summary.md` y veredicto `interferencia` cuando una suite empieza con eventos o trabajos ajenos (TC-PLATFORM-PIPELINE-024 y 026) (2026-10-23: `perf-report.test.ts` y `background-load.test.ts`, escritos antes del código y vistos fallar; agregación por suite y por benchmark, campo aditivo `backgroundLoad`, tabla en `perf-summary.md` con marcadores y veredicto `interferencia`; TC-PLATFORM-PIPELINE-024 y 026)
- [x] 2.2 `apps/api/test/perf/background-load.ts`: foto con eventos pendientes del outbox, trabajos por cola `events.*` y estado, conexiones por rol, aplicación y estado, locks no concedidos, `pg_stat_user_tables` de las tablas citadas en el design, `os.loadavg()` y marca de tiempo; consultas en serie sobre un mismo cliente (nunca `Promise.all` sobre el mismo cliente) (2026-10-23: `takeBackgroundLoad` con consultas en serie sobre un mismo cliente; el SQL se validó contra un PostgreSQL 16 local con `pgboss.job` particionada; los fallos al observar no hacen fallar el benchmark; la foto real en el contenedor la valida `nightly`, tarea 7.2)
- [x] 2.3 Tomar la foto al empezar y al terminar cada suite `*.perf.ts` y antes de cada benchmark; publicar el orden real de los archivos en el reporte (2026-10-23: `recordSuiteLoad` en las 8 suites `*.perf.ts`; registro `background-load.ndjson` y `refreshReportFiles` para las suites posteriores a `nightly`; el orden real sale de la hora de la foto inicial; el reporte de una corrida real, tarea 7.2)
- [x] 2.4 `commitments.perf.ts`: publicar los trabajos que hay en la cola del matcher al empezar la medición y calcular el throughput solo con los eventos de la ráfaga (TC-PLATFORM-PIPELINE-025) (2026-10-23: trabajos de la cola del matcher antes de la ráfaga y con la ráfaga encolada, y ev/s del primer al último evento (`burstWindow`, con test unitario) junto al ev/s desde el arranque; la aserción de D112 no cambia; la ejecución real, tarea 7.2; TC-PLATFORM-PIPELINE-025 sigue `not_automated` hasta la purga de D291)

## 3. EXPERIMENTOS (decisiones 1 y 3; rama `claude/investigate-perf-under-load-experiments`, no se fusiona)

- [ ] 3.1 Preparar la rama: variables `PF_PERF_SUITES`, purga del backlog, handler trivial, concurrencia por consumidor y `pg_stat_statements` en el contenedor; desactivar en la rama el paso de aviso por issue de `perf`. Lanzar cada corrida fuera de la ventana de las 06:00 UTC (`concurrency: nightly` cancela la corrida en curso) y anotar run id y hora
- [ ] 3.2 E1 (base limpia, `spendable` y `commitments` solas) ×3: acepta o descarta H7 y fija la línea base
- [ ] 3.3 E2 y E3 (`spendable` con el backlog residual, sin y con purga) ×3, con `EXPLAIN (ANALYZE, BUFFERS)` de sus consultas y `pg_stat_user_tables`: H3 y H4
- [ ] 3.4 E4 y E5 (matcher con la cola vacía y con el backlog) ×3: H1
- [ ] 3.5 E6 y E7 (throughput por consumidor con muestreo de locks, esperas, consultas y conexiones) ×3: H4, H5 y H6
- [ ] 3.6 E8 (un consumidor a la vez y handler trivial, incluidos `planning.journal-entry-posted` y `reporting.data-version`) ×3: H2 y H5

## 4. INFORME (decisión 6)

- [ ] 4.1 `docs/NN-perf-under-load-findings.md` (siguiente número libre de `docs/`): por síntoma S1–S3, hipótesis aceptadas y descartadas con medianas y dispersión de las repeticiones, causa, camino (arreglo del benchmark, change de producto con nombre propuesto, ajuste de umbral a decidir por el owner o change de optimización) y responsable
- [ ] 4.2 Preguntas que abra el informe (ajustes de umbral, changes de producto, el umbral por consumidor con handler real de D292 si el informe lo propone, el runner si la contención resulta la única causa, D293) en un doc `docs/NN-…-questions.md` con opciones y recomendación; sus respuestas en el siguiente `…-decisions.md`
- [ ] 4.3 Redactar o proponer en docs/38 los changes de seguimiento que el informe identifique (sin implementarlos aquí)

## 5. AISLAMIENTO del benchmark (decisión 4; purga del backlog residual, D291)

- [ ] 5.1 Tests primero: con una base de fixture con eventos pendientes ajenos, la suite falla con el veredicto `interferencia` y la cantidad medida (TC-PLATFORM-PIPELINE-026); sin ellos mide normalmente (TC-PLATFORM-PIPELINE-024)
- [ ] 5.2 Implementar la purga del backlog residual (D291) en la base efímera tras la medición de throughput (marcar o borrar los eventos pendientes del outbox y vaciar las colas `events.*`), solo en el harness de pruebas y en el mismo job; precondición de aislamiento al empezar cada suite. Si el informe (grupo 4) muestra que el volumen de la base (H3) también influye, detenerse y preguntar al owner por una base por suite antes de implementar
- [ ] 5.3 Verificar que la purga no cambia `nightly.yml` ni agrega jobs (D291 descarta el job aparte); si algún paso del job lo requiere, actualizar el test de política y verificar que no cambia ningún check requerido

## 6. UMBRALES fijados (decisión 5)

- [x] 6.1 Test de política en `scripts/delivery-policy/test/nightly-policy.test.ts`: `PERF_THRESHOLDS`, `PERF_THROUGHPUT` y las constantes locales de las suites coinciden con docs/02 §PERF y las filas bloqueantes siguen siéndolo; con fixtures 300 → 400 ms y 42 → 5 ev/s la regla falla indicando el benchmark y ambos valores (TC-PLATFORM-PIPELINE-028). Unificar `BUDGET_MS` y `GOAL_EVENTS_PER_SECOND` con las constantes de `perf-report.ts` si simplifica la regla, sin cambiar sus valores (2026-10-23: `nightly-policy.test.ts` con tabla esperada verificada contra docs/02, extracción por AST de `PERF_THRESHOLDS`, `PERF_THROUGHPUT` y las constantes de las suites, filas bloqueantes y fixtures 300 → 400 ms y 42 → 5 ev/s; `BUDGET_MS` de `spendable.perf.ts` y `GOAL_EVENTS_PER_SECOND` de `commitments.perf.ts` ahora salen de `perf-report.ts`, mismos valores; TC-PLATFORM-PIPELINE-028 automatizado)

## 7. VERIFICACIÓN en GitHub y regresión

- [x] 7.1 Gates: `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm traceability:check`, `pnpm spec:validate` (2026-10-23: `format:check`, typecheck/lint/test de `@pf/api` y `@pf/delivery-policy` y build de `@pf/api` y sus dependencias con `pnpm --filter`/`-r` porque `pnpm turbo` da «Exec format error» en la sesión, `arch:check`, `traceability:check`, `spec:validate`, `config:docs:check` y `openspec validate --strict` en verde)
- [ ] 7.2 Tras fusionar los grupos 2, 5 y 6: `nightly` por `workflow_dispatch`; anotar en TC-PLATFORM-PIPELINE-024..026 la carga de fondo publicada por suite y el resultado de S1, S2 y S3
- [ ] 7.3 Regresión: las aserciones de TC-COMMITMENTS-MATCH-012, TC-REPORTING-SPENDABLE-014, TC-PLATFORM-PIPELINE-018 y de los demás benchmarks no cambian (ni sus umbrales)

## 8. DOCS y cierre

- [ ] 8.1 docs/23 §5.5 (carga de fondo en el reporte, aislamiento, umbrales fijados, resumen del informe); notas con causa y camino en TC-COMMITMENTS-MATCH-012, TC-REPORTING-SPENDABLE-014 y TC-PLATFORM-PIPELINE-018 (TC-PLATFORM-PIPELINE-027); docs/38 (fila 48, §4 sin los pendientes resueltos)
- [ ] 8.2 Criterio de salida: cada test rojo de `perf` del alcance (S1, S2 y cada fila de S3 bajo meta) tiene causa medida y un camino registrado; TC-PLATFORM-PIPELINE-024..026 y 028 a `automated` y 027 a `manual` con `status: ready`; `pnpm traceability:check` y `pnpm exec openspec validate investigate-perf-under-load --strict`
