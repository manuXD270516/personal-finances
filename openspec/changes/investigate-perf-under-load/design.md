# Diseño: investigate-perf-under-load

## Contexto

El job `perf` del nightly (docs/23 §5.5) corre `pnpm perf:bench`: Vitest con `apps/api/vitest.perf.config.ts` (`fileParallelism: false`, sin orden de archivos fijado), un único PostgreSQL 18 de Testcontainers creado por `test/support/global-setup.ts` y compartido por todas las suites `apps/api/test/perf/*.perf.ts`, y una API en proceso por suite. `nightly.perf.ts` carga el Large Seed por los casos de uso y, al final, mide el throughput de cada consumidor real con un worker completo durante hasta 600 s (`PF_PERF_THROUGHPUT_SECONDS`); al cerrar ese worker, el backlog que no alcanzó a drenar queda en `platform.outbox` y en las colas pg-boss `events.<consumidor>`, en la misma base que usan después las demás suites.

Síntomas de la corrida manual 39669892721 (2026-10-21, commit 68f01e5, runner `ubuntu-latest` de 4 CPU):

| Síntoma | Benchmark | Medido | Umbral | Tipo |
|---|---|---|---|---|
| S1 | `commitments.perf.ts` [TC-COMMITMENTS-MATCH-012]: ráfaga de 1 050 eventos (1 000 importadas + 50 reentregadas) al matcher | ~6,2 ev/s | ≥ 42 ev/s (D112, NFR-PERF-008) | bloqueante |
| S2 | `spendable.perf.ts` [TC-REPORTING-SPENDABLE-014] [TC-PLATFORM-PIPELINE-018]: `getReportSummary` con el bloque spendable y `getSpendable` con 300 ocurrencias | p95 352,2 ms y 341,1 ms | ≤ 300 ms (NFR-PERF-004) | bloqueante |
| S3 | `nightly.perf.ts`, NFR-PERF-008: throughput por consumidor real drenando el backlog del Large Seed | 0,04–9 ev/s; ~470 165 eventos pendientes al empezar | ≥ 42 ev/s | informativo |

S2 se midió por primera vez en esa corrida (antes recibía 429). S1 falla desde la corrida #12. Pasan, en la misma corrida y la misma base, loan-simulator (TC-DEBT-AMORT-045), goals, subscriptions, upcoming-payments e imports, lo que no descarta la interferencia: depende del orden en que corrió cada archivo y de qué colas toca.

Decisiones del owner que se aplican:

| Decisión | Origen | Aplicación |
|---|---|---|
| D290 | docs/46 | Change de investigación que reúne S1–S3; reemplaza `investigate-consumer-throughput` y la investigación del spendable propuestas en docs/38 §4 |
| D285 | docs/46 | El job `perf` sigue bloqueante mientras tanto; ninguna fila roja pasa a informativa ni se mueve a otro job sin decisión nueva |
| D287 | docs/46 | La fila de RLS INCLUDE no es parte de este change (`optimize-rls-policy-overhead`) |
| D291 | docs/48 | Aislamiento por purga del backlog residual (outbox y colas `events.*`) en la base efímera del benchmark tras medir el throughput, solo en el harness y en un solo job (decisión 4) |
| D292 | docs/48 | La fila de throughput por consumidor con handler real sigue informativa hasta que el informe proponga un umbral por consumidor, que se decide en una pregunta aparte |
| D293 | docs/48 | El job `perf` sigue en el runner estándar (`ubuntu-latest`, 4 CPU); los umbrales de docs/02 se tratan como locales y la contención (H2) se mide dentro de ese límite |
| D43 | docs/31 | Qué filas son bloqueantes no cambia |
| D112 | docs/33 | Meta del matcher: ≥ 42 ev/s |
| D152 | docs/33 | La persistencia del import ≤ 20 s está diferida a Phase 6 (fuera) |
| D224, D270 | docs/41, docs/43 | El nightly no es check requerido; el issue "nightly perf: umbral superado" recibe el resumen de cada corrida |
| CLAUDE.md | Regla del proyecto | Presupuesto de conexiones API 22 + worker 33 = 55 de 60; no agregar consumidores sin justificarlo |

| Elemento | Capa | Cambio |
|---|---|---|
| `apps/api/test/perf/perf-report.ts`, `perf-report.test.ts` | tests de rendimiento | Sección de carga de fondo por suite y por benchmark; veredicto "interferencia" (decisión 2) |
| `apps/api/test/perf/background-load.ts` (nuevo) | tests de rendimiento | Toma una foto de la carga de fondo de la base y del host (decisión 2) |
| `apps/api/test/perf/*.perf.ts` | tests de rendimiento | Foto de carga al empezar cada suite; precondición de aislamiento (decisión 4) |
| Purga del backlog residual (D291) | tests de rendimiento | Purga del outbox y de las colas `events.*` en la base efímera tras la medición de throughput y precondición de aislamiento al empezar cada suite (decisión 4); sin job aparte ni base por suite |
| `scripts/delivery-policy/test/nightly-policy.test.ts` | test de política | Umbrales de los benchmarks fijados a docs/02 (decisión 5) |
| Rama `claude/investigate-perf-under-load-experiments` | experimentos (no se fusiona) | Variantes E1–E8 lanzadas por `workflow_dispatch` (decisión 3) |
| `docs/NN-perf-under-load-findings.md` (nuevo, siguiente número libre) | documentación | Informe con causa medida, evidencia y camino por síntoma (decisión 6) |
| Código de producción, OpenAPI, eventos, migraciones | — | Sin cambios en este change |

## Objetivos / No objetivos

**Objetivos**

- Medir la causa de S1, S2 y S3 con experimentos que aceptan o descartan cada hipótesis, con al menos tres repeticiones por experimento.
- Que el benchmark mida solo el trabajo de cada suite y publique la carga de fondo con la que midió.
- Dejar para cada rojo un camino concreto, aprobado por el owner cuando cambia un umbral.

**No objetivos**

- Arreglar el producto dentro de este change: cada causa de producto abre un change de seguimiento con su propia spec y medición.
- Optimizar las políticas RLS (change 49).
- Cambiar umbrales, la lista de filas bloqueantes, la protección de `main` o los checks requeridos.
- Medir en un entorno distinto del runner estándar de GitHub (D293; si el informe demuestra que la contención del runner es la única causa, se vuelve a preguntar al owner con la evidencia).
- Volver bloqueante la fila de throughput por consumidor con handler real (D292).

## Decisiones

1. **Hipótesis a probar, cada una con su experimento.** Ninguna se da por cierta antes de medir:

   | Id | Hipótesis | Síntomas | Cómo se acepta o descarta |
   |---|---|---|---|
   | H1 | **Backlog compartido en las colas.** El worker del test de throughput publica parte del outbox del Large Seed en las colas `events.<consumidor>` y se cierra con trabajos pendientes; `commitments.perf` arranca su matcher sobre la misma cola `events.commitments.occurrence-matcher` y procesa primero el backlog ajeno, así que su contador (inbox del workspace de la suite) avanza despacio | S1 | E4 y E5: trabajos en la cola del matcher al empezar la suite; ráfaga con base limpia frente a base con el backlog |
   | H2 | **Contención de CPU** en el runner de 4 CPU: PostgreSQL, la API, el worker y el proceso de Vitest compiten; un worker que siga vivo de una suite anterior agrava | S1, S2, S3 | E1–E3 con la foto de carga del host; E8 con un solo consumidor |
   | H3 | **Volumen y estado de la base tras el Large Seed:** estadísticas desactualizadas, autovacuum o analyze en curso, tablas e índices hinchados (`pgboss.job`, `platform.outbox`, `platform.inbox`, `ledger.posting`), caché fría; puede cambiar el plan de las consultas de disponible para gastar aunque usen otro workspace | S2 | E1 frente a E2 y E3; `EXPLAIN (ANALYZE, BUFFERS)` de las consultas de la suite en cada variante; `pg_stat_user_tables` (`n_dead_tup`, `last_autoanalyze`) |
   | H4 | **Contención de locks o de índices:** consumidores que escriben filas calientes (p. ej. la versión de datos por workspace de `reporting.data-version`, el aprovisionamiento de periodos de `planning.journal-entry-posted`) mientras el benchmark lee o escribe | S1, S2, S3 | Muestras de `pg_locks` no concedidos y `wait_event` de `pg_stat_activity` cada segundo durante E2 y E6 |
   | H5 | **Consumidores concretos lentos:** algunos handlers reales tardan mucho por evento (consultas sin índice, transacciones largas) | S3 (y S1 por arrastre) | E6: duración por evento y por consumidor (`event_consumer_duration_seconds`) y consultas más costosas durante el drenaje (`pg_stat_statements` si el contenedor se arranca con la extensión; si no, muestreo de `pg_stat_activity`) |
   | H6 | **Presupuesto de conexiones:** los pools de la API, del worker y de los tests del harness, sumados, rozan o superan `max_connections` del contenedor, o la concurrencia de consumidores espera conexiones del pool | S1, S3 | E7: conexiones por rol y estado, esperas de adquisición del pool, `max_connections` del contenedor |
   | H7 | **Lentitud real de disponible para gastar,** independiente de la carga | S2 | E1: p95 con la base limpia, sin Large Seed; si supera 300 ms, la causa es del producto |

2. **Instrumentación primero, y se fusiona.** `background-load.ts` toma una foto con: eventos con `published_at IS NULL` en `platform.outbox`; trabajos por cola `events.*` y estado (`created`, `retry`, `active`); conexiones de `pg_stat_activity` por `usename`, `application_name` y `state`; locks no concedidos; `pg_stat_user_tables` de las tablas citadas; `os.loadavg()` y CPU del proceso; marca de tiempo. Se toma al empezar y al terminar cada suite y antes de cada benchmark. `perf-report.ts` la agrega a `perf-results.json` (campo aditivo `backgroundLoad` por suite y por resultado) y a `perf-summary.md` (tabla por suite), con el orden real de los archivos. Tests unitarios de la agregación y del formato (TDD). Sirve para la investigación y queda como señal permanente: el issue de D270 la recibe cada noche.
3. **Experimentos en una rama que no se fusiona.** La rama `claude/investigate-perf-under-load-experiments` agrega variables de entorno al harness y, si hace falta, ajusta `nightly.yml` en la rama (un `workflow_dispatch` usa el workflow de la rama): filtro de suites (`PF_PERF_SUITES`), purga del backlog, duración del throughput, handler trivial, concurrencia de consumidores y `pg_stat_statements`. Reglas: cada experimento se repite al menos 3 veces; se lanza lejos de la ventana programada de las 06:00 UTC porque `concurrency: nightly` cancela la corrida en curso; en la rama se desactiva el paso de aviso por issue para no comentar el issue real; los resultados (artefactos y resúmenes) se copian al informe. Experimentos:

   | Exp. | Variante | Hipótesis |
   |---|---|---|
   | E1 | `spendable` y `commitments` solas, base limpia (sin Large Seed) | H7, línea base de H1 |
   | E2 | Large Seed + throughput como hoy, después `spendable` con el backlog residual y sin worker | H3, H4 |
   | E3 | Como E2, purgando el backlog residual (outbox y colas `events.*`) antes de `spendable` | H3 frente a backlog |
   | E4 | `commitments` sola con la cola del matcher vacía | H1 |
   | E5 | Large Seed + throughput, después `commitments`: trabajos en la cola del matcher al empezar y throughput de la ráfaga | H1 |
   | E6 | Throughput por consumidor con el handler real, con muestreo de locks, esperas y consultas | H4, H5 |
   | E7 | Como E6 con el presupuesto de conexiones medido (pools y `max_connections`) | H6 |
   | E8 | Un solo consumidor activo a la vez (p. ej. `planning.journal-entry-posted`, `reporting.data-version`) y con handler trivial | H2, H5; separa el costo del handler del costo de la cola |

4. **Aislamiento del benchmark (requirement Must).** Después de la investigación, cada suite verifica al empezar, con la foto de la decisión 2, que no hay eventos pendientes ni trabajos de colas `events.*` ajenos a ella; si los hay, falla con el veredicto `interferencia` y la cantidad medida, sin publicar su p95 como válido. Para que no los haya, el owner eligió (D291) purgar en la base efímera del benchmark el backlog residual al terminar la medición de throughput (marcar o borrar las filas pendientes del outbox y vaciar las colas `events.*`), que es barato, mantiene un solo job y no cambia el producto. Si el informe muestra que el volumen de la base (H3) también influye, se reconsidera una base por suite con una pregunta nueva al owner. La medición de throughput con el backlog completo (S3) se mantiene: es la que mide la carga real; lo que se evita es que contamine a las suites siguientes. La purga solo existe en el harness de pruebas, nunca en código de producción.
5. **Umbrales fijados a docs/02.** El test de política lee `PERF_THRESHOLDS` y `PERF_THROUGHPUT` de `perf-report.ts` y las constantes locales de las suites (`BUDGET_MS` de `spendable.perf.ts`, `GOAL_EVENTS_PER_SECOND` de `commitments.perf.ts`, o su import desde `perf-report.ts` si se unifican) y verifica que coinciden con la tabla de umbrales de docs/02 §PERF (NFR-PERF-001..008) y que las filas bloqueantes siguen siéndolo. Cambiar un umbral exige editar la tabla esperada del test con un comentario que cite la decisión del owner (D-id); la revisión del PR lo comprueba. Con fixtures: 300 → 400 ms y 42 → 5 ev/s hacen fallar la regla indicando el benchmark y ambos valores (TC-PLATFORM-PIPELINE-028).
6. **Informe y criterio de salida.** El informe (`docs/NN-perf-under-load-findings.md`) tiene, por síntoma: hipótesis aceptadas y descartadas con sus mediciones (mediana y dispersión de las repeticiones), la causa, el camino y su responsable. Caminos posibles: (a) arreglo del benchmark (p. ej. el aislamiento de la decisión 4); (b) arreglo del producto, en un change de seguimiento con nombre propuesto; (c) ajuste de umbral, solo con una decisión del owner que cite la evidencia; (d) change de optimización. El change se cierra cuando S1 y S2 (y cada fila de S3 bajo meta) tienen causa medida y camino, el resumen está en docs/23 §5.5 y en las notas de TC-COMMITMENTS-MATCH-012, TC-REPORTING-SPENDABLE-014 y TC-PLATFORM-PIPELINE-018, y las preguntas que abra el informe están en un doc de preguntas.

## Contratos

Sin cambios en OpenAPI, eventos ni `ErrorCode`. `perf-results.json` (artefacto interno del nightly) agrega el campo opcional `backgroundLoad` en cada suite y en cada resultado, y el veredicto `interferencia`. Es aditivo: `renderMarkdown`, el paso de resumen de `nightly.yml` y el issue de D270 siguen leyendo los mismos campos.

## Riesgos / Trade-offs

- **Experimentos caros y ruidosos:** cada corrida del job `perf` tarda 2–4 h y los runners varían. Mitigación: filtro de suites para no cargar el Large Seed cuando no hace falta (E1, E4, E8), tres repeticiones y comparación de medianas.
- **Aislar puede esconder un defecto real:** si el producto en producción también acumula backlog, medir sin él da una foto optimista. Mitigación: S3 se sigue midiendo con el backlog completo y el informe compara E2 con E3.
- **Cancelar la corrida programada:** `concurrency: nightly` con `cancel-in-progress`. Mitigación: lanzar fuera de la ventana de las 06:00 UTC y anotar la hora.
- **Hallazgos de producción grandes** (p. ej. un consumidor que necesita otro modelo de concurrencia): no se arreglan aquí; abren un change de seguimiento y su pregunta al owner.
- **El job `perf` sigue en rojo** hasta que se apliquen los caminos (D285).

## Plan de migración

Sin migraciones ni cambios de producción. Orden: grupo 2 (instrumentación, se fusiona) antes de los experimentos (grupo 3, rama no fusionada); el informe (grupo 4) antes del aislamiento (grupo 5, con la purga de D291; va después del informe porque este puede reabrir la elección si H3 influye) y los umbrales fijados (grupo 6, independiente, puede ir con el grupo 2). Sin Docker en la sesión se escriben y verifican los tests unitarios y de política (grupos 2, 5 y 6) y los documentos (grupos 1, 4 y 8); toda medición (grupo 3 y la verificación del grupo 7) la hace el job `perf` por `workflow_dispatch`: los experimentos desde la rama `claude/investigate-perf-under-load-experiments`, que no se fusiona. Rollback: revertir el PR; ningún dato cambia.

## Preguntas resueltas

Las preguntas 1 a 3 de [docs/47](../../../docs/47-investigate-perf-under-load-questions.md) se resolvieron el 2026-10-23 con la recomendación de cada una ([docs/48](../../../docs/48-perf-and-rls-owner-decisions.md)):

1. Mecanismo de aislamiento: purga del backlog residual en la base efímera tras medir el throughput (D291). Desbloquea el grupo 5.
2. Fila de throughput por consumidor con handler real: sigue informativa hasta que el informe proponga un umbral por consumidor (D292).
3. Runner del job `perf`: el estándar de 4 CPU, con los umbrales de docs/02 como locales (D293).

No quedan preguntas abiertas; las que abra el informe van a un doc de preguntas nuevo (tarea 4.2).
