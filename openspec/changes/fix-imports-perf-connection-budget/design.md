# Diseño: fix-imports-perf-connection-budget

## Contexto

`apps/api/test/perf/imports.perf.ts` [TC-IMPORTS-CSV-029] corre en el job `perf` del nightly, la última en el orden fijo `PERF_SUITE_ORDER` (change 48). Arranca un harness con la API y un worker completo en el mismo proceso (`startHarness({ worker: true, apiEnv: PERF_RATE_LIMITS })`), sube un CSV de 5 000 filas, lo aprueba y mide: vista previa ≤ 30 s, persistencia con el techo de regresión de 300 s (la meta de 20 s está diferida a Phase 6, D152) y drenado de todos los consumidores `events.*` y del outbox en ≤ 120 s **después** de la persistencia (`drainMs - persistMs ≤ DRAIN_BUDGET_MS`, D112). El drenado se observa con `until(…, DRAIN_BUDGET_MS + 60_000, 500)` y el reporte actual solo publica en consola `perConsumerDrainedMs` (desde la aprobación, no desde la persistencia).

Rojos observados, ninguno medido:

| Corrida | Fecha | Manifestación |
|---|---|---|
| E10, run 40154960947 (rama de experimentos del change 48) | 2026-10-25 | `timeout exceeded when trying to connect`, a los 34 s de la suite |
| Programado 40322158874 (`main`, 69d8388) | 2026-10-26 | Drenado de 123,5 s después de la persistencia frente a 120 s (`expected 123458.95 to be less than or equal to 120000`); suite de 335 s. Las demás suites del job, en verde |

Hechos del código que orientan las hipótesis (verificados en `main`, 69d8388):

- Los pools `pg` de la API (`apps/api/src/runtime/platform-resources.ts`) y del worker (`apps/api/src/worker/create-worker-runtime.ts`) usan `max: DATABASE_POOL_MAX` y `connectionTimeoutMillis: HEALTH_CHECK_TIMEOUT_MS`. Por omisión, `DATABASE_POOL_MAX` es 52 por proceso y `HEALTH_CHECK_TIMEOUT_MS` 2 000 ms (`docs/config-reference.md`). `timeout exceeded when trying to connect` es el error de `pg` cuando una adquisición espera más que `connectionTimeoutMillis`: o el pool está lleno del lado del cliente, o el servidor tarda en aceptar.
- La cola pg-boss abre su propio pool por proceso (`packages/platform/src/queue/pgboss-job-queue.ts`, `max: poolMax ?? 4`).
- El harness abre pools administrativos propios (`asAdmin`, `apps/api/test/support/harness.ts`).
- El PostgreSQL de Testcontainers (`apps/api/test/support/global-setup.ts`) no fija `max_connections`: usa el valor por omisión de la imagen. Todas las suites `*.perf.ts` comparten ese contenedor y corren en serie en el mismo proceso de Vitest.
- Plantilla del host en producción (`deploy/compose/compose.prod.yaml`): `max_connections=70`, API 22 + worker 34 = 56 (D249, change 40). CLAUDE.md, docs/38 §4 y docs/50 todavía citan «22 + 33 = 55 de 60»; la cifra vigente es la de la plantilla. El worker valida al arrancar que la concurrencia sumada de sus consumidores más 4 reservadas cabe en `DATABASE_POOL_MAX` (TC-PLATFORM-EVENTS-019).

Decisiones del owner que se aplican:

| Decisión | Origen | Aplicación |
|---|---|---|
| D299 | docs/52 | Este change: medir conexiones y drenado por consumidor y corregir según la causa; alcance con las dos manifestaciones; sin subir `max_connections` sin medir ni el umbral de 120 s |
| D112 | docs/33 | Drenado de cada consumidor en ≤ 120 s; meta del matcher ≥ 42 ev/s |
| D152 | docs/35 | Persistencia del import ≤ 20 s diferida a Phase 6 (fuera) |
| D249 | docs/41 | Plantilla del host: `max_connections=70`, API 22 + worker 34 |
| D285, D43 | docs/46, docs/31 | El job `perf` sigue bloqueante; ninguna fila pasa a informativa |
| D291, D302 | docs/48, docs/52 | La purga, la espera de quietud y el runner estándar no cambian |
| D300, D301 | docs/52 | El throughput por consumidor con handler real y su optimización quedan fuera (Phase 6) |

| Elemento | Capa | Cambio |
|---|---|---|
| `apps/api/test/perf/connection-budget.ts` (nuevo) y su test | tests de rendimiento | Suma de los pools del benchmark frente a `max_connections` y muestreo de conexiones por pool y del servidor (decisiones 2 y 3) |
| `apps/api/test/perf/imports.perf.ts` | tests de rendimiento | Precondición de presupuesto, muestreo durante persistencia y drenado, drenado por consumidor desde la persistencia y veredictos `conexiones` y de drenado (decisiones 2 a 4) |
| `apps/api/test/perf/perf-report.ts`, `perf-report.test.ts` | tests de rendimiento | Campos aditivos de conexiones y de drenado por consumidor en `perf-results.json` y `perf-summary.md` |
| `apps/api/test/support/` | tests | Solo si el arreglo es del benchmark: pools de la suite y `max_connections` del contenedor efímero (decisión 5) |
| Código de producción | — | Solo si la medición lo exige (decisión 5), con su test y, si cambia un comportamiento especificado, su delta |
| Rama `claude/fix-imports-perf-experiments` | diagnóstico (no se fusiona) | Corridas M1–M4 por `workflow_dispatch` (decisión 6) |

## Objetivos / No objetivos

**Objetivos**

- Medir la causa de cada manifestación (conexiones y drenado marginal) antes de cambiar nada.
- Que la suite falle con un veredicto que distinga conexiones de drenado y publique lo que midió.
- Dejar `imports.perf.ts` en verde en dos nightlies programados seguidos sin cambiar umbrales.

**No objetivos**

- La persistencia ≤ 20 s (D152) y la escritura masiva del import (Phase 6).
- Optimizar el throughput de los consumidores con handler real (D300, D301).
- Cambiar el presupuesto de conexiones de producción (`max_connections=70`, API 22 + worker 34) sin una medición que lo justifique y una decisión del owner.
- Subir `max_connections` del contenedor del benchmark sin medir (D299, opción c descartada), cambiar el umbral de 120 s o pasar la fila a informativa.

## Decisiones

1. **Hipótesis, cada una con su medición.** Ninguna se da por cierta antes de medir:

   | Id | Hipótesis | Manifestación | Cómo se acepta o descarta |
   |---|---|---|---|
   | HI1 | **Pool lleno del lado del cliente:** durante la persistencia y el drenado todas las conexiones de un pool (API o worker) están ocupadas y una adquisición espera más de 2 000 ms (`HEALTH_CHECK_TIMEOUT_MS`) | conexiones | M1: `totalCount`, `idleCount` y `waitingCount` de cada pool muestreados cada segundo; la espera máxima de adquisición |
   | HI2 | **Límite del servidor:** la suma de los pools máximos del benchmark (API y worker con 52 por omisión, colas pg-boss, harness) supera `max_connections` del contenedor | conexiones | M1: `max_connections` y `superuser_reserved_connections` de `pg_settings`; pico de `pg_stat_activity` por `application_name`; el error del servidor sería `too many clients`, no un timeout del pool |
   | HI3 | **Conexiones de suites anteriores sin cerrar** en el mismo contenedor | conexiones | M1: conexiones por `application_name` y `backend_start` al empezar la suite (la foto de carga de fondo del change 48 ya las publica por rol y estado) |
   | HI4 | **Conexión lenta por contención del host:** el servidor tarda más de 2 s en aceptar con la carga del host alta | conexiones | M2: duración del `connect` frente a `os.loadavg()` muestreado; repetir con el host en quietud |
   | HI5 | **Un consumidor concreto marca el drenado** (p. ej. `planning.journal-entry-posted` o `reporting.data-version` con 5 000 transacciones), cerca de 120 s por su costo por evento, por la varianza del runner o por esperas de conexión (HI1) | drenado | M3: pendientes por consumidor al terminar la persistencia, tiempo hasta 0 desde la persistencia y ev/s por consumidor, junto a las esperas del pool del worker |

2. **Precondición de presupuesto.** Antes de subir el archivo, la suite calcula la suma de los pools máximos que va a abrir (API, worker, colas pg-boss de cada proceso y pools del harness) y la compara con `max_connections` menos `superuser_reserved_connections` del contenedor. Si no cabe, falla sin medir, con la suma, el límite y el detalle por pool. Es una función pura con test unitario (TC-PLATFORM-PIPELINE-029).
3. **Muestreo y veredicto `conexiones`.** Un muestreador (cada segundo, sin `Promise.all` sobre el mismo cliente) registra por pool `totalCount`, `idleCount`, `waitingCount` y la espera máxima de adquisición, y del servidor el pico de `pg_stat_activity` por `application_name` frente a `max_connections`. Si una adquisición vence (`timeout exceeded when trying to connect`), la suite falla con el veredicto `conexiones`: pool, conexiones en uso, máximo y espera; el reporte lo publica separado del resultado del drenado (TC-PLATFORM-PIPELINE-030).
4. **Drenado por consumidor desde la persistencia.** Al terminar la persistencia se registran los pendientes de cada cola `events.*` y del outbox; el reporte publica por consumidor los pendientes iniciales, el tiempo hasta 0 medido desde la persistencia y el ritmo (ev/s). Si el total supera 120 s, el fallo nombra los consumidores que terminaron después de 120 s con su tiempo (TC-PLATFORM-PIPELINE-031 y 032). La aserción de D112 y `DRAIN_BUDGET_MS` no cambian; el test de política (TC-PLATFORM-PIPELINE-028) los sigue fijando.
5. **Arreglo según la causa medida.** Opciones, a elegir con la evidencia de M1–M4 y registrar en el informe (tarea 3.2):

   | Opción | Tipo | Aplica si | Límite |
   |---|---|---|---|
   | A1 Dimensionar los pools de API y worker de la suite como la plantilla del host (concurrencia sumada + 4 reservadas en el worker) | benchmark | HI2 o HI3: la suma de pools por omisión (52 + 52 + colas + harness) no cabe en el contenedor | El benchmark mide con pools realistas; no toca producción |
   | A2 Fijar `max_connections` del contenedor efímero a la suma medida más un margen | benchmark | HI2, y A1 no basta | Solo con la suma medida (D299 descarta subirlo a ciegas) |
   | A3 Cerrar pools y harness de suites anteriores antes de `imports` | benchmark | HI3 | — |
   | A4 Separar el timeout de adquisición de los pools del timeout de los health checks (variable propia) | producto | HI1 o HI4: el pool espera más de 2 s en un pico legítimo | Configuración nueva: `docs/config-reference.md` y `pnpm config:docs:check`; delta de spec si cambia un comportamiento especificado |
   | A5 Ajustar la concurrencia de un consumidor lento dentro de `DATABASE_POOL_MAX` | producto | HI5 con un consumidor identificado | Si cambia la suma frente a la plantilla del host (D249) o el presupuesto de producción, pregunta al owner antes; TC-PLATFORM-EVENTS-019 sigue valiendo |

   No son opciones: subir el umbral de 120 s, pasar la fila a informativa, subir `max_connections` de producción o agregar consumidores sin una decisión del owner.
6. **Regla de proceso: medir por `workflow_dispatch` desde una rama no fusionada.** Las corridas de diagnóstico van por `workflow_dispatch` de `nightly` desde la rama `claude/fix-imports-perf-experiments`, que no se fusiona (un `workflow_dispatch` usa el workflow de la rama). En la rama se puede filtrar `PF_PERF_SUITES` (p. ej. `nightly` → `imports`, para conservar la fase de throughput) y se desactiva el paso de aviso por issue de `perf`. Se lanza lejos de las 06:00 UTC (`concurrency: nightly` cancela la corrida en curso) y se anota run id, hora y commit. Mediciones: M1 (conexiones por pool y del servidor, orden de `main`), M2 (M1 con el host en quietud forzada al empezar la suite), M3 (drenado por consumidor, orden de `main`), M4 (`imports` sola sin el Large Seed, línea base). Al menos dos repeticiones de M1 y M3; la confirmación final la dan dos nightlies programados seguidos (tarea 6.2).
7. **Criterio de salida.** Cada manifestación tiene causa medida y camino aplicado; `imports.perf.ts` pasa en dos nightlies programados seguidos con el reporte de conexiones y de drenado publicado; TC-IMPORTS-CSV-029 anota la causa y el camino.

## Contratos

Sin cambios en OpenAPI, eventos ni `ErrorCode`. `perf-results.json` (artefacto interno del nightly) agrega campos opcionales en el resultado de `imports.perf.ts`: `connections` (por pool: `max`, pico en uso, pico de esperas, espera máxima de adquisición en ms; del servidor: `maxConnections`, `reserved`, pico por `application_name`) y `drainByConsumer` (por cola: `pendingAtPersist`, `drainedAfterPersistMs`, `eventsPerSecond`), y el veredicto `conexiones` junto a los existentes. Es aditivo: `renderMarkdown`, el paso de resumen de `nightly.yml` y el issue de D270 siguen leyendo los mismos campos. Si el arreglo A4 agrega una variable de configuración, se documenta en `docs/config-reference.md` con su valor por omisión y no cambia el comportamiento por omisión de producción sin decisión.

## Riesgos / Trade-offs

- **Ajustar solo el harness puede esconder un problema de producción:** si los pools del benchmark se achican hasta pasar, pero producción tiene la misma presión. Mitigación: A1 usa la plantilla del host como referencia y el informe compara la suma medida con `max_connections=70`.
- **Corridas caras y con varianza:** ≈ 60 min por corrida (D302). Mitigación: filtro de suites y dos repeticiones de M1 y M3.
- **Muestrear también consume conexiones:** el muestreador usa una conexión propia y la cuenta en la suma de la precondición.
- **El drenado marginal puede ser varianza del runner:** 123,5 s frente a 120 s es un 3 % de exceso. Si M3 no identifica un consumidor ni esperas de conexión, el informe lo dice y se pregunta al owner antes de tocar nada; el umbral no cambia por omisión.

## Plan de migración

Sin migraciones. Orden: grupo 2 (medición y veredictos, se fusiona; tests unitarios sin Docker) → grupo 3 (diagnóstico por `workflow_dispatch` desde la rama no fusionada e informe) → grupo 4 (arreglo según la causa) → grupo 6 (dos nightlies programados). Sin Docker en la sesión, los tests unitarios y de política se verifican con `pnpm turbo test` y toda medición la hace el job `perf`. Rollback: revertir el PR; ningún dato cambia.

## Preguntas abiertas

Ninguna bloquea el orden de implementación. Pueden abrirse con la medición: (1) si la causa pide cambiar el presupuesto de conexiones de producción o la concurrencia de un consumidor frente a la plantilla del host; (2) si el drenado marginal no tiene causa medida y es varianza del runner. Ambas irían a un doc `docs/NN-…-questions.md` con opciones y recomendación antes del grupo 4.
