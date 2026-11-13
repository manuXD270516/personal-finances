# Diseño: stabilize-import-persist-perf

## Contexto

Motivación y alcance: ver proposal.md. Fuentes: NFR-PERF-007 (docs/02: persistencia ≤ 20 s, Must), D152 (docs/35, cumplida por el change 52), D291 (aislamiento del benchmark), D300 y D359 (`throughput.perf.ts` informativa), D302 (runner estándar de 4 CPU), D311 (fila del host bloqueante), D312 (drenado ≤ 120 s por consumidor), D360 (estadísticas de la cola, #205), el change 52 `add-bulk-imported-transactions` (implementado; sin archivar porque falta su tarea 5.2, dos nightlies programados seguidos) y los informes [docs/53](../../../docs/53-imports-perf-findings.md) y [docs/59](../../../docs/59-consumer-throughput-findings.md).

### Evidencia de los nightlies (job `perf`, `ubuntu-latest`, PostgreSQL 18 en Testcontainers)

Persistencia en segundos de TC-IMPORTS-CSV-029 (host = fila bloqueante; código = informativa), persistencia de la fase A de `throughput.perf.ts` (consumidores de la ráfaga detenidos, relay activo) y tres indicadores de la velocidad del runner tomados del mismo log: la mediana de la evaluación de reglas en memoria (`rules.perf.ts`, 5 000 × 200, CPU pura), el ritmo del matcher (TC-COMMITMENTS-MATCH-012) y el listado paginado de NFR-PERF-001 con el Large Seed.

| Fecha (run) | Commit | Reglas (ms) | Factor CPU | Matcher (ev/s) | NFR-PERF-001 (s) | Fase A | Host | Código | Host / factor |
|---|---|---|---|---|---|---|---|---|---|
| 10-30 (41104116257, dispatch) | `ea586126` | 57 | 1,06 | 806 | 19,0 | 12,0 | 14,7 | 19,5 | 13,9 |
| 11-02 (41470065467) | `7d825710` | 54 | 1,00 | 855 | 17,2 | 12,1 | 17,1 | 20,2 | 17,1 |
| 11-03 (41648631472) | `7d825710` | 53 | 0,98 | 818 | 16,5 | 12,7 | 14,4 | 15,3 | 14,7 |
| 11-04 (41844086904) | `7d825710` | 123 | 2,28 | 441 | 29,2 | 24,9 | **32,7** | 39,9 | 14,4 |
| 11-05 (42044759397) | `adefbb29` | 87 | 1,61 | 525 | 24,8 | 19,0 | **25,7** | 29,7 | 15,9 |
| 11-06 (42230043897) | `adefbb29` | 86 | 1,59 | 603 | 23,9 | 16,9 | **25,0** | 28,7 | 15,7 |
| 11-07 (42373809363) | `0952f108` | 89 | 1,65 | 497 | 23,2 | 19,8 | 18,4 | 24,1 | 11,2 |
| 11-08 (42483000755) | `8c4b2612` | 54 | 1,00 | 817 | 17,0 | sin dato (falló) | 19,9 | 21,8 | **19,9** |

Factor CPU = mediana de reglas / 54 ms. Correlación de Pearson entre el factor y la persistencia del host: r = 0,88 (8 corridas). El 11-07 el job falló por otra fila (`nightly.perf.ts`, umbral de p95), no por el import.

Otros datos de las corridas:

- **11-08, fila del host:** casi todas las colas con 0 pendientes al terminar la persistencia salvo `events.reporting.data-version` (9 900, drenada en 7,1 s); en la del código, backlog en `debt.card-activity` (7 700), `goals.balance-watch` (3 100), `commitments.occurrence-matcher` (1 200) y `planning.*` (≈ 700–800). Pico de conexiones del worker: 8 de 34 en el host.
- **11-08, `throughput.perf.ts`:** la fase A falló en `persistBacklog` (línea 142), en la espera del outbox en 0 tras la persistencia (tope 600 s), y la fase B falló en cascada (`burstDefs` vacío). La suite siguiente purgó 91 894 trabajos `events.*`: el relay había publicado casi toda la ráfaga (≈ 15 000 eventos con su abanico), así que el outbox quedó con un residuo que no bajó o con un relay muy lento al final.
- **Duración de `throughput.perf.ts`:** 74–97 s en los runners rápidos hasta el 11-03; 132–198 s del 11-04 al 11-07; 805 s el 11-08 (por el tope de la fase A).
- **Change 52, tarea 5.2 (2026-10-29):** lote de 200 filas ≈ 650 ms en local (ledger 220 ms, `insertMany` 200 ms, outbox 90 ms, recorrido 110 ms); 25 lotes ≈ 16 s.

### Pipeline medido

`POST …/imports/{id}/approve` → hecho `imports.ImportApproved` en el outbox → relay → cola `imports.persist` (pg-boss, sondeo) → `PersistImportService.persist`: una unidad de trabajo para pasar a `PERSISTING`; por cada lote de 200 filas, una transacción de BD (`runDetached`) con `staging.loadBatch` → `RecordImportedTransactions` (`insertMany` de transacciones, splits y vínculos; `postJournalEntries` con disparadores de integridad por fila, diferidos al confirmar; auditoría, recorrido y 600 eventos en el outbox) → `staging.markPersisted` → `links.insertMany` → bloqueo y guardado del job; por fila con ocurrencia confirmada, unidades de trabajo aparte; al final, una unidad de trabajo de cierre (fallas, reconciliación, cobertura de reglas, `ImportCompleted`). La prueba sondea `GET …/imports/{id}` cada 500 ms. En paralelo, el relay publica los ≈ 600 eventos de cada lote en ≈ 6 colas cada uno (≈ 3 600 filas en `pgboss.job_common` por lote, ≈ 90 000 en total) y, con la configuración del host, los consumidores de la ráfaga procesan a la vez, todo sobre el mismo PostgreSQL y las mismas 4 CPU que la API, el worker y Vitest.

## Objetivos / No objetivos

**Objetivos:**

1. Medir dónde se va la persistencia (desglose por etapa y por paso) y cómo era el runner, en cada nightly.
2. Separar con experimentos la varianza del runner, la regresión del código y la contención, y aceptar o descartar cada hipótesis con números.
3. Implementar en este change el arreglo del benchmark que corresponda y las optimizaciones del producto que no requieren decisión del owner, hasta cumplir el criterio de salida (D403, [docs/64](../../../docs/64-import-persist-perf-decisions.md)) con el umbral de 20 s intacto.
4. Que `throughput.perf.ts` vuelva a completar sus dos fases o, si su preparación no termina, que publique un diagnóstico sin decidir el veredicto (D300, D359).

**No objetivos:** cambiar umbrales (20 s, 30 s, 120 s) ni volver informativa la fila del host; cambiar el runner (D302) sin decisión del owner; cambiar contratos, eventos, auditoría o invariantes; desactivar disparadores de integridad; optimizar el pipeline por documentos (OFX y PDF tienen margen); el throughput sobre el backlog del Large Seed (informativo, D312).

## Decisiones

### 1. Hipótesis medibles

| Id | Hipótesis | Evidencia hoy | Predicción medible | Experimento |
|---|---|---|---|---|
| H1 | **Varianza del runner.** La persistencia escala con la velocidad del runner (CPU y disco), que varía 1,0–2,3× entre corridas | Mismo commit `7d825710`: 14,4 s (11-03) y 32,7 s (11-04); reglas 53 → 123 ms; r = 0,88 | La persistencia dividida por el factor de calibración queda en una banda estrecha (± 15 %) en runners de factor distinto | P1, P2 |
| H2 | **Regresión del código entre `7d825710` y `8c4b2612`**, sobre todo #216: el worker del benchmark registra `reporting.cash-flow-watch` con pasada de arranque (`commitmentsOnStart` no se desactiva en el harness) y cron horario que no respeta `scheduleCrons`; la pasada recorre todos los workspaces activos (Large Seed incluido) y calcula el calendario del horizonte de la alerta | 11-08 con runner de referencia: 19,9 s frente a 14,4–17,1 s; la fase A se estanca por primera vez; #216 es el único cambio de producto entre la corrida del 11-07 y la del 11-08 | En pares en el mismo runner, `main` sin la pasada de arranque ni el cron baja ≥ 2 s respecto de `main` por omisión y queda a ± 1 s de `7d825710` | P3 |
| H3 | **Contención durante la persistencia** con el relay (≈ 90 000 trabajos encolados) y con los consumidores de la ráfaga que drenan a la vez (configuración del host) en 4 CPU compartidas | Fase A (consumidores detenidos) 12,0–12,7 s frente a host 14,4–17,1 s en runners de referencia | Host − fase A = costo de los consumidores (esperado 2–4 s); fase A − persistencia con el relay pausado = costo del relay | P4 |
| H4 | **Costo propio por lote**: sentencias fijas por lote (lectura del staging, vínculos, bloqueo y guardado del job, confirmación) y disparadores por fila del ledger | 650 ms por lote en local, 25 lotes en serie | El desglose muestra qué paso domina; el costo fijo por lote se estima con lotes de 200, 500 y 1 000; el tiempo de las funciones de disparador se mide con `track_functions` | P1, P5 |
| H5 | **Estado de la base al empezar la suite**: tuplas muertas en `pgboss.job_common` y `platform.outbox` por la purga de la suite anterior (91 894 trabajos el 11-08), limpieza automática y puntos de control que coinciden con la persistencia, `shared_buffers` de 128 MB con el Large Seed | La suite del import corre después de `throughput.perf.ts` y de la purga; la espera de quietud llegó a 50–60 s del 11-04 al 11-06 | La persistencia en una base nueva (sin Large Seed ni suites previas) es ≥ 20 % menor; el muestreo muestra limpieza automática o puntos de control durante los lotes lentos | P1, P6 |
| H6 | **Confirmaciones y disco**: 25 confirmaciones de lote más las unidades de trabajo pequeñas esperan el `fsync` del WAL, sensible al disco del runner | Sin dato (el reporte no publica esperas) | Las esperas `WALSync`/`WALWrite`/`DataFileRead` suman ≥ 20 % de la persistencia en los runners lentos | P1, P7 |
| H7 | **Estancamiento del relay** en la ráfaga: la consulta de cabezas por agregado (anti-join sobre `platform.outbox` pendiente) se degrada con estadísticas viejas o índices parciales hinchados, o una transacción larga retiene el horizonte de MVCC, o un evento falla siempre al encolarse | Fase A del 11-08: outbox sin llegar a 0 en 600 s; antes, ≤ 25 s | Al vencer el tope, el diagnóstico muestra un residuo con `last_error`, un plan con bucle anidado sobre miles de filas o una transacción abierta de minutos | P8 |
| H8 | **Ruido de la medición**: espera inicial de la cola (sondeo de pg-boss) y granularidad de 500 ms del sondeo de la prueba | Sin dato | Espera inicial + observación ≤ 1,5 s; si es mayor, es un costo a reducir (despertar la cola) y no ruido | P1 |

### 2. Instrumentación (se fusiona antes de los experimentos)

- **Desglose de la persistencia** (requirement «El benchmark del import publica el desglose de la persistencia»): un puerto opcional `PersistTimings` en IMPORTS (`ImportsDeps`, application) que `PersistImportService` invoca con marcas de tiempo por etapa y por paso del lote (`performance.now()` alrededor de cada llamada ya existente: `loadBatch`, `recordBatch` desglosado por `RecordImportedTransactions` en transacciones, asientos, auditoría, recorrido y outbox, `markPersisted`, `links.insertMany`, guardado del job, `COMMIT`). En producción el puerto es un no-op (sin costo ni dependencia nueva); el worker del harness inyecta un recolector. Sin cambios de contrato ni de esquema: el recolector entra por una opción de `createWorkerRuntime` análoga a la de `metrics` que el harness ya usa para los consumidores.
- **Espera inicial y observación:** se derivan de la aprobación (respuesta 202), el inicio de `persist` y el cierre, más el instante en que la prueba observa `COMPLETED`.
- **Muestreo durante la persistencia** (conexión aparte del superusuario, cada 250 ms, como `LockWaitSampler`): `pg_stat_activity` (`wait_event_type`, `wait_event`, `backend_type` para autovacuum y checkpointer), `pg_stat_progress_vacuum`, deltas de `pg_stat_checkpointer`, `pg_stat_wal` y `pg_stat_io`, trabajos `events.*` encolados y `os.loadavg()`. Se publica por lote (lote atípico > 3 × mediana) y en total.
- **Huella del runner** (requirement «Huella del runner publicada en el reporte de rendimiento»): `os.cpus()` (modelo, cantidad), `os.totalmem()`, una calibración de CPU de carga fija y determinista (la evaluación de 5 000 filas × 200 reglas de `rules.perf.ts`, mediana de 5, sin la base) y una calibración de confirmaciones (`INSERT` + `COMMIT` de 500 filas en una tabla temporal, mediana de confirmaciones por segundo). La referencia inicial es 54 ms (mediana de las corridas rápidas de la tabla) y se registra en docs/23 §5.5; la de confirmaciones se fija con las tres primeras corridas. Informativa: nunca repite ni invalida (D407).
- **Trabajos programados en la ventana** (requirement «El benchmark del import mide sin trabajos programados ajenos»): el harness arranca el worker con `commitmentsOnStart: false` (la opción que hoy gobierna la pasada de arranque de `reporting.cash-flow-watch`) y sin el digest, como ya hace con `ledgerMaintenanceOnStart`, `fxGapFillOnStart` y los demás; `registerCashFlowWatchJob` pasa a respetar `scheduleCrons` como los jobs de NOTIFY (corrección del worker, sin efecto en producción, donde los crons siguen activos). El reporte lista los trabajos de colas no `events.*` que empezaron dentro de la ventana, con su duración (`pgboss.job` por `started_on`).
- **`throughput.perf.ts` sin decidir el veredicto** (requirement «Una suite informativa no decide el veredicto aunque su preparación no termine»): `persistBacklog` atrapa el vencimiento de sus dos esperas, publica la fila «sin completar» con el diagnóstico del outbox (pendientes por `event_type`, `publish_attempts`, `last_error`, antigüedad del más viejo, `EXPLAIN` de la consulta del relay y la transacción abierta más larga de `pg_stat_activity`) y la fase B usa las definiciones de la ráfaga aunque la fase A no termine. Aplica D300 y D359; no toca ninguna fila bloqueante.

### 3. Experimentos en orden

Rama `claude/import-persist-perf-experiments` (no se fusiona), `workflow_dispatch` de `nightly` con un grupo de concurrencia propio y el aviso por issue desactivado en la rama, filtro de suites (`PF_PERF_SUITES`) y repeticiones dentro del mismo job para comparar en el mismo runner. Cada experimento informa mediana y rango de ≥ 3 repeticiones y la huella del runner.

| Orden | Experimento | Qué mide | Acepta / descarta |
|---|---|---|---|
| P1 | Instrumentación fusionada, observada en 3 nightlies programados (sin costo extra) | Desglose por etapa y paso, esperas, mantenimiento concurrente, huella | Ordena H3–H6 y H8 por peso; confirma H1 si la persistencia normalizada queda en ± 15 % |
| P2 | Mismo job, mismo runner: suite `imports` sola ×3 y suite completa ×1, en `main` | Ruido dentro de un mismo runner frente al ruido entre runners | H1: dispersión intra-runner ≤ 10 % y entre runners ≥ 40 % |
| P3 | Pares alternados ABAB en el mismo runner: `7d825710` + instrumentación, `main`, `main` sin la pasada de arranque ni el cron de `reporting.cash-flow-watch`, `main` sin el refresco de estadísticas de #205 | Regresión atribuible a cada cambio | H2: diferencia ≥ 2 s con el mismo signo en las 3 repeticiones |
| P4 | Suite `imports` en cuatro variantes en el mismo runner: host; consumidores de la ráfaga detenidos (como la fase A); relay pausado durante la persistencia (el outbox se publica después); código | Costo de los consumidores y del relay sobre la persistencia | H3: el componente es significativo si supera 2 s o el 15 % |
| P5 | `IMPORT_PERSIST_BATCH_SIZE` = 200, 500 y 1 000 en el mismo runner; `track_functions = 'pl'` en el contenedor de la rama | Costo fijo por lote y peso de los disparadores por fila | H4: costo fijo = pendiente de la recta tiempo vs. cantidad de lotes; disparadores ≥ 25 % del lote habilitan la tarea 7.6 con un ADR (D404) |
| P6 | Suite `imports` en base nueva (sin Large Seed ni suites previas), en el orden completo, y en el orden completo con `VACUUM (ANALYZE)` de `pgboss.job_common` y `platform.outbox` tras la purga | Efecto del estado de la base | H5: base nueva ≥ 20 % más rápida o el `VACUUM` recupera ≥ 2 s |
| P7 | Variante de la rama con `synchronous_commit = off` en el contenedor (solo para acotar; no se adopta: D405) | Peso de la espera del WAL | H6: si baja ≥ 20 %, la confirmación es el cuello y se priorizan menos confirmaciones (lotes más grandes) |
| P8 | `throughput.perf.ts` ×3 en `main` con el diagnóstico del vencimiento, y ×3 sin la pasada ni el cron de `reporting.cash-flow-watch` | Causa del estancamiento del relay | H7 por la causa que muestre el diagnóstico; comparte causa con H2 si desaparece sin el trabajo programado |

P1 va primero porque no cuesta corridas y ordena el resto; P2 y P3 deciden si hay regresión antes de optimizar; P4–P7 se corren solo para las hipótesis que P1 deje con peso ≥ 10 %; P8 corre junto con P3 (comparte las variantes).

### 4. Qué se implementa según el resultado

| Resultado | Arreglo en este change | Requiere owner |
|---|---|---|
| H2 aceptada (trabajo programado) | Benchmark: arranque sin la pasada (ya en la decisión 2). Producto: el cron respeta `scheduleCrons`; si una pasada cuesta ≥ 2 s de base con el Large Seed, change de seguimiento para acotarla (solo workspaces con cambios desde la pasada anterior) | No (el seguimiento se propone en docs/38) |
| H2 aceptada (#205) | El refresco de estadísticas pasa a una sola instancia por proceso y solo con trabajos pendientes en la cola, manteniendo D360 | No |
| H3 aceptada (relay) | Lote del relay mayor (menos transacciones; sin cambio de orden por agregado) | Regular el relay mientras corre un import cambia la latencia de NFR-PERF-008: D406 la permite solo si el drenado sigue ≤ 120 s y el retraso de los demás eventos no empeora |
| H3 aceptada (consumidores) | Ninguno salvo D406: con la configuración del host los consumidores deben drenar en ≤ 120 s (D312), y frenarlos durante el import es una regulación | Solo con la condición de D406 |
| H4 aceptada (costo fijo por lote) | Subir `IMPORT_PERSIST_BATCH_SIZE` hasta 1 000 con la evidencia de P5 (decisión 4 del change 52, sin tocar los scenarios de fallo parcial) y unir sentencias por lote (staging y vínculos en una sola sentencia; un guardado del job por lote) | No |
| H4 aceptada (disparadores por fila ≥ 25 %) | Ninguno salvo D404 | Solo con la evidencia y el ADR de D404 |
| H5 aceptada | Benchmark: `VACUUM (ANALYZE)` de las tablas que la propia purga del harness deja con tuplas muertas (extiende D291). Producto: parámetros de limpieza automática por tabla en `platform.outbox` (migración expand) si P6 lo justifica | No |
| H6 aceptada | Menos confirmaciones por lote (lotes más grandes, H4) | No: D405 descarta `synchronous_commit` local |
| H7 aceptada | Corregir la causa que muestre el diagnóstico (estadísticas o índice de `platform.outbox`, transacción larga, evento que falla siempre), con su test de integración | No, salvo que cambie una conducta de `platform/event-delivery` (entonces delta con `/opsx:update`) |
| Solo H1 (sin margen alcanzable) | Ninguno en el producto | D408: se decide solo si queda únicamente H1 |

**Objetivo de diseño (no es un umbral):** que la persistencia del host en un runner de factor 1,0 quede por debajo del objetivo de D403 (≤ 12 s, que soporta un runner 1,65× más lento como los del 11-05 al 11-07). La fila sigue decidiéndose solo frente a 20 s.

### 5. Criterio de salida

1. Cada hipótesis H1–H8 aceptada o descartada con su experimento, registrada en `docs/NN-import-persist-perf-findings.md` (siguiente número libre) y resumida en docs/23 §5.5.
2. La fila del host de TC-IMPORTS-CSV-029 con persistencia ≤ 20 s en 5 nightlies programados seguidos (D403), con la huella del runner publicada en cada uno.
3. `throughput.perf.ts` completa sus dos fases en esos nightlies o, si no, publica el diagnóstico sin decidir el veredicto y H7 tiene causa medida.
4. TC-IMPORTS-CSV-029, TC-PLATFORM-THROUGHPUT-008 y TC-PLATFORM-THROUGHPUT-012 enlazan el informe.

## Resultados de P1 y diagnóstico del estancamiento (2026-11-12)

Fuente: `imports-perf.json` y el log del job `perf` de los tres nightlies programados posteriores al #224 (runs 42836095108, 43033178794 y 43242108275).

| Run | Runner (huella) | Código: persistencia / drenado | Host: persistencia = espera inicial + lotes | Pendientes del outbox al terminar el código |
|---|---|---|---|---|
| 11-10 | EPYC 9V45, CPU 38 ms (0,71), 10 674 confirmaciones/s | 13,6 s / **no llegó a 0 en 180 s** | **251 s** = 244,3 s + 6,5 s | 12 201 |
| 11-11 | EPYC 9V74, CPU 55 ms (1,02), 5 851 confirmaciones/s | 19,4 s / **no llegó a 0 en 180 s** | **577 s** = 556,4 s + 20,2 s | 12 801 |
| 11-12 | EPYC 9V45, CPU 37 ms (0,69), 9 814 confirmaciones/s | 20,3 s / 8,9 s | 16,4 s = 0,01 s + 16,1 s | 6 601 |

- **La espera inicial es todo el exceso.** En los dos rojos los 25 lotes del host duraron 6,5 s y 20,2 s (mediana de lote 275 y 810 ms): el tiempo se fue entre la aprobación y el inicio de `persist` (`initialWaitMs`). La hipótesis H8 (espera de la cola) queda descartada como ruido y reemplazada por esta causa.
- **Causa de la contaminación (confirmada con los datos).** La fila del código termina su persistencia en tiempo, pero su drenado vence a los 180 s con 12 201 y 12 801 eventos aún sin publicar (el relay publicó solo unos 2 200–2 800 de ≈ 15 000 durante la persistencia y nada más después). `imports.perf.ts` lanzaba entonces el `until: timeout` (el job fallaba por la fila informativa) y la fila del host arrancaba sobre ese backlog: el relay publica por orden de secuencia y `ImportApproved` quedaba detrás de él, y las colas y el relay competían con el worker nuevo. La persistencia del host medía el drenado ajeno. Con la base en reposo (11-12) la espera inicial es de 13 ms.
- **Causa del estancamiento del relay en la fila del código: no probada.** Ritmo del relay durante la persistencia: ≈ 200 y ≈ 115 eventos/s en los rojos frente a ≈ 420 en el verde (`peakQueuedEventJobs` 300–500 frente a 2 000–3 900). Indicios: en los dos rojos el estancamiento del host termina justo cuando terminan limpiezas automáticas de `pgboss.job_common` (a +247 s en el 11-10; a +432, +492 y +552 s en el 11-11), y ambos arrancan con ≈ 181 000 filas muertas en `pgboss.job` (129 000 en el verde) tras la purga de 1 176 621 trabajos de `spendable.perf.ts` y las suites previas; las esperas muestreadas no explican nada (más del 95 % de las muestras sin espera: no es E/S sino CPU o consultas lentas). Es compatible con H5 (filas muertas y estadísticas viejas) y con H7 (consulta de cabezas del relay), sin descartar las consultas de entrega de las colas `key_strict_fifo` con concurrencia 4. No hay evidencia para tocar el relay ni los lotes de producción; el código de producción no se cambia.
- **Mantenimiento y trabajos programados.** Código: un punto de control de 250 ms en los tres; el 11-10 y el 11-12 corrieron `__pgboss__send-it` y un trabajo diario (`commitments.subscription-daily` 1 092 ms; `goals.daily-evaluation` 1 807 ms) dentro de la ventana, ahora publicados; ninguno en el host.
- **Desglose del lote (las tres corridas sin estancamiento de espera).** La confirmación domina en el código (`commit` 8,2 s, 11,7 s y 12,0 s de 13,3, 18,8 y 19,6 s de lotes; en el host del 11-12, 9,3 de 16,1 s) y `tx.ledger` pesa 1,7–2,9 s; esperas dominantes `LWLock:WALWrite` (37–70 %) e `IO:WalSync`. Lo orienta a H6 (confirmaciones y disco) para P1; falta el peso por runner con más corridas.
- **Huella.** Dos generaciones de runner: EPYC 9V45 (CPU 37–38 ms, ≈ 10 000 confirmaciones/s) y 9V74 (55 ms, ≈ 5 900). La referencia de confirmaciones queda en 9 814 (mediana de las tres corridas); la de CPU de 54 ms sigue provisional: la calibración sintética da 37–38 ms en el runner rápido, así que el factor 0,7 no significa «más rápido que la referencia» sino que la referencia de 54 ms corresponde al 9V74.
- **H1 (varianza del runner).** Con tres puntos el rojo del 11-11 (CPU 1,02) no se explica por el runner; la normalización por factor no se puede aceptar ni descartar hasta tener 5 corridas sin estancamiento.

**Arreglo en este change (benchmark).** `imports.perf.ts` prepara cada configuración con `isolateConfiguration` (`persist-instrumentation.ts`): con el worker anterior detenido purga el outbox y los trabajos `events.*`, ejecuta `VACUUM (ANALYZE)` de `platform.outbox` y `pgboss.job`, espera la quietud del host y verifica el reposo (0 pendientes, 0 trabajos abiertos, 0 consultas ajenas); la fila bloqueante falla con el motivo si no lo logra. El drenado que vence se publica con el diagnóstico del outbox y el seguimiento (un punto cada 10 s durante la persistencia y el drenado) sin lanzar un error. TC-PLATFORM-PIPELINE-042 y -043.

**No medible sin nightlies reales (pendiente).** Si con el aislamiento la fila del código sigue sin drenar en 180 s: el seguimiento, el `EXPLAIN` del relay y la transacción más larga del reporte dirán si es H5 o H7; P3, P6 y P8 siguen pendientes. El peso de H6 por runner y H1 necesitan más corridas.

## Contratos

- **OpenAPI:** sin cambios.
- **Eventos:** sin cambios.
- **Contratos públicos:** sin cambios. El puerto `PersistTimings` es interno de IMPORTS (`application/ports`), opcional y sin implementación en producción; no se exporta por `@pf/imports/contracts`. Si una optimización de H4 necesita un método por lote nuevo en un contrato de otro contexto, será aditivo y se describe aquí con `/opsx:update` antes de implementarlo.
- **Configuración:** sin variables de producto nuevas. `IMPORT_PERSIST_BATCH_SIZE` puede cambiar su valor por omisión según P5 (decisión 4 del change 52). Variables del harness en la rama de experimentos: `PF_PERF_SUITES` y las de cada variante; no se fusionan.
- **ErrorCode:** sin códigos nuevos.

## Riesgos / Trade-offs

- **La medición altera lo medido:** marcas de tiempo en memoria y muestreo cada 250 ms en una conexión aparte; P2 compara la persistencia con y sin el recolector en el mismo runner (diferencia aceptable ≤ 3 %).
- **Normalizar por la huella podría esconder un problema:** la huella es informativa y no corrige ninguna medición (D407).
- **Aislar los trabajos programados podría esconder un costo real de producción:** P3 y P8 miden el trabajo con y sin él, y el costo se publica; si pesa, va a un change de seguimiento.
- **Lotes más grandes:** transacciones más largas sobre el ledger (hasta ≈ 3 s con 1 000 filas en el runner lento) y un registro manual concurrente que espera un lote; un error de dominio revierte más filas (el reintento por lote no cambia). Se acepta solo con la evidencia de P5.
- **Experimentos caros y ruidosos:** pares en el mismo runner y ≥ 3 repeticiones; grupo de concurrencia propio para no cancelar los programados.

## Plan de migración

Sin migraciones previstas. Si P6 justifica parámetros de limpieza automática en `platform.outbox`, o P8 un índice, van en una migración expand aparte con timestamp posterior a la última de `main`, sin RLS nueva (la tabla ya la tiene). Orden: instrumentación y aislamiento (se fusionan) → P1 en los programados → P2/P3/P8 → P4–P7 según P1 → arreglos → nightlies del criterio de salida. Rollback: la instrumentación es un no-op en producción; cada optimización es reversible por configuración (`IMPORT_PERSIST_BATCH_SIZE`) o por revertir su commit.

## Dependencias entre changes

- **Change 52 (`add-bulk-imported-transactions`):** su tarea 5.2 (dos nightlies programados seguidos ≤ 20 s) es la misma evidencia que el criterio de salida de este change; D409 la cierra con una nota que traslada la evidencia a este change y el change 52 se archiva en un PR aparte.
- **Independiente de** los changes de Phase 7 pendientes de archivar; si se fusiona otro trabajo programado con pasada de arranque, el harness lo desactiva igual (requirement «El benchmark del import mide sin trabajos programados ajenos»).

## Preguntas abiertas

Resueltas el 2026-11-09 en [docs/64](../../../docs/64-import-persist-perf-decisions.md) (pregunta N de [docs/63](../../../docs/63-import-persist-perf-questions.md) → D(402+N)), todas con la recomendación: D403 (criterio de salida: 5 nightlies programados seguidos ≤ 20 s y objetivo interno ≤ 12 s), D404 (disparadores por sentencia solo con ≥ 25 % de peso en P5 y un ADR), D405 (sin `synchronous_commit` asíncrono), D406 (regular el relay o los consumidores solo si el drenado sigue ≤ 120 s y los demás eventos no se retrasan más), D407 (huella solo informativa), D408 (el runner de D302 no se decide ahora) y D409 (la tarea 5.2 del change 52 se cierra trasladando la evidencia a este change). No queda ninguna pregunta abierta.
