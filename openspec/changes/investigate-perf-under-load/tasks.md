# Tareas

> Change de investigación: sin dominio, aplicación, API, UI ni migraciones. El entregable de implementación es un informe con la causa medida de cada rojo de `perf` y su camino; los arreglos del producto van en changes de seguimiento. Sin Docker, `pnpm perf:bench` no corre en la sesión: las mediciones las hace el job `perf` por `workflow_dispatch` (rama de experimentos) y se dice en el informe. El job `perf` sigue bloqueante mientras tanto (D285). Preguntas en [docs/47](../../../docs/47-investigate-perf-under-load-questions.md): la 1 bloquea solo el grupo 5.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar el delta de `platform/delivery-pipeline`; `pnpm exec openspec validate investigate-perf-under-load --strict`
- [ ] 1.2 Revisar TC-PLATFORM-PIPELINE-024..028 contra los scenarios; pasarlos a `ready` al empezar la implementación

## 2. INSTRUMENTACIÓN del benchmark (decisión 2; se fusiona)

- [ ] 2.1 Tests unitarios en `apps/api/test/perf/perf-report.test.ts`, escritos antes que el código (TDD): agregación de la foto de carga de fondo por suite y por benchmark, campo aditivo `backgroundLoad` en `perf-results.json`, tabla en `perf-summary.md` y veredicto `interferencia` cuando una suite empieza con eventos o trabajos ajenos (TC-PLATFORM-PIPELINE-024 y 026)
- [ ] 2.2 `apps/api/test/perf/background-load.ts`: foto con eventos pendientes del outbox, trabajos por cola `events.*` y estado, conexiones por rol, aplicación y estado, locks no concedidos, `pg_stat_user_tables` de las tablas citadas en el design, `os.loadavg()` y marca de tiempo; consultas en serie sobre un mismo cliente (nunca `Promise.all` sobre el mismo cliente)
- [ ] 2.3 Tomar la foto al empezar y al terminar cada suite `*.perf.ts` y antes de cada benchmark; publicar el orden real de los archivos en el reporte
- [ ] 2.4 `commitments.perf.ts`: publicar los trabajos que hay en la cola del matcher al empezar la medición y calcular el throughput solo con los eventos de la ráfaga (TC-PLATFORM-PIPELINE-025)

## 3. EXPERIMENTOS (decisiones 1 y 3; rama `claude/investigate-perf-under-load-experiments`, no se fusiona)

- [ ] 3.1 Preparar la rama: variables `PF_PERF_SUITES`, purga del backlog, handler trivial, concurrencia por consumidor y `pg_stat_statements` en el contenedor; desactivar en la rama el paso de aviso por issue de `perf`. Lanzar cada corrida fuera de la ventana de las 06:00 UTC (`concurrency: nightly` cancela la corrida en curso) y anotar run id y hora
- [ ] 3.2 E1 (base limpia, `spendable` y `commitments` solas) ×3: acepta o descarta H7 y fija la línea base
- [ ] 3.3 E2 y E3 (`spendable` con el backlog residual, sin y con purga) ×3, con `EXPLAIN (ANALYZE, BUFFERS)` de sus consultas y `pg_stat_user_tables`: H3 y H4
- [ ] 3.4 E4 y E5 (matcher con la cola vacía y con el backlog) ×3: H1
- [ ] 3.5 E6 y E7 (throughput por consumidor con muestreo de locks, esperas, consultas y conexiones) ×3: H4, H5 y H6
- [ ] 3.6 E8 (un consumidor a la vez y handler trivial, incluidos `planning.journal-entry-posted` y `reporting.data-version`) ×3: H2 y H5

## 4. INFORME (decisión 6)

- [ ] 4.1 `docs/NN-perf-under-load-findings.md` (siguiente número libre de `docs/`): por síntoma S1–S3, hipótesis aceptadas y descartadas con medianas y dispersión de las repeticiones, causa, camino (arreglo del benchmark, change de producto con nombre propuesto, ajuste de umbral a decidir por el owner o change de optimización) y responsable
- [ ] 4.2 Preguntas que abra el informe (ajustes de umbral, changes de producto) en un doc `docs/NN-…-questions.md` con opciones y recomendación; sus respuestas en el siguiente `…-decisions.md`
- [ ] 4.3 Redactar o proponer en docs/38 los changes de seguimiento que el informe identifique (sin implementarlos aquí)

## 5. AISLAMIENTO del benchmark (decisión 4; requiere la respuesta a la pregunta 1 de docs/47)

- [ ] 5.1 Tests primero: con una base de fixture con eventos pendientes ajenos, la suite falla con el veredicto `interferencia` y la cantidad medida (TC-PLATFORM-PIPELINE-026); sin ellos mide normalmente (TC-PLATFORM-PIPELINE-024)
- [ ] 5.2 Implementar el mecanismo que elija el owner (recomendado: purga del backlog residual en la base efímera tras la medición de throughput) solo en el harness de pruebas; precondición de aislamiento al empezar cada suite
- [ ] 5.3 Si el mecanismo cambia `nightly.yml` (p. ej. un job aparte), actualizar el test de política y verificar que no cambia ningún check requerido

## 6. UMBRALES fijados (decisión 5)

- [ ] 6.1 Test de política en `scripts/delivery-policy/test/nightly-policy.test.ts`: `PERF_THRESHOLDS`, `PERF_THROUGHPUT` y las constantes locales de las suites coinciden con docs/02 §PERF y las filas bloqueantes siguen siéndolo; con fixtures 300 → 400 ms y 42 → 5 ev/s la regla falla indicando el benchmark y ambos valores (TC-PLATFORM-PIPELINE-028). Unificar `BUDGET_MS` y `GOAL_EVENTS_PER_SECOND` con las constantes de `perf-report.ts` si simplifica la regla, sin cambiar sus valores

## 7. VERIFICACIÓN en GitHub y regresión

- [ ] 7.1 Gates: `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm traceability:check`, `pnpm spec:validate`
- [ ] 7.2 Tras fusionar los grupos 2, 5 y 6: `nightly` por `workflow_dispatch`; anotar en TC-PLATFORM-PIPELINE-024..026 la carga de fondo publicada por suite y el resultado de S1, S2 y S3
- [ ] 7.3 Regresión: las aserciones de TC-COMMITMENTS-MATCH-012, TC-REPORTING-SPENDABLE-014, TC-PLATFORM-PIPELINE-018 y de los demás benchmarks no cambian (ni sus umbrales)

## 8. DOCS y cierre

- [ ] 8.1 docs/23 §5.5 (carga de fondo en el reporte, aislamiento, umbrales fijados, resumen del informe); notas con causa y camino en TC-COMMITMENTS-MATCH-012, TC-REPORTING-SPENDABLE-014 y TC-PLATFORM-PIPELINE-018 (TC-PLATFORM-PIPELINE-027); docs/38 (fila 48, §4 sin los pendientes resueltos)
- [ ] 8.2 Criterio de salida: cada test rojo de `perf` del alcance (S1, S2 y cada fila de S3 bajo meta) tiene causa medida y un camino registrado; TC-PLATFORM-PIPELINE-024..026 y 028 a `automated` y 027 a `manual` con `status: ready`; `pnpm traceability:check` y `pnpm exec openspec validate investigate-perf-under-load --strict`
