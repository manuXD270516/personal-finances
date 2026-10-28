# 53: Informe de `imports.perf.ts`: presupuesto de conexiones y drenado por consumidor (change 48b)

> **Estado:** Registrado · **Fecha:** 2026-10-28 · **Change:** [`fix-imports-perf-connection-budget`](../openspec/changes/fix-imports-perf-connection-budget/proposal.md) (48b), grupo 3 · **Relacionado:** [design del change](../openspec/changes/fix-imports-perf-connection-budget/design.md) (hipótesis HI1–HI5), [52-perf-under-load-owner-decisions.md](52-perf-under-load-owner-decisions.md) (D299–D303), [50-perf-under-load-findings.md](50-perf-under-load-findings.md) (H6), [54-imports-perf-questions.md](54-imports-perf-questions.md) (preguntas abiertas)

Informe de la tarea 3.2: qué se midió en `imports.perf.ts` [TC-IMPORTS-CSV-029], qué hipótesis se aceptan o descartan, la causa de cada manifestación y el camino aplicado. No cambia ningún umbral (`PREVIEW_BUDGET_MS`, `PERSIST_CEILING_MS`, `DRAIN_BUDGET_MS` = 120 s, D112) ni el presupuesto de conexiones de producción (TC-PLATFORM-PIPELINE-028).

## 1. Resumen

| Manifestación | Causa medida | Camino | Estado |
|---|---|---|---|
| (1) Adquisición de conexión vencida (`timeout exceeded when trying to connect`, E10, 2026-10-25) | **No reproducida en 23 corridas** del job `perf` con la purga y la quietud (D291). El uso real es de 30–40 conexiones del servidor sobre 100, el pool del worker llega a 27 de 52 y de la API a 1, sin una sola adquisición en espera y con una espera máxima de 108 ms frente a un tiempo de espera de 1 500 ms. Lo que sí estaba mal es el **presupuesto declarado** del benchmark: la suma de sus pools máximos (API 52 + worker 52 + 2 colas pg-boss de 4 + 3 del harness = **115**) no cabía en las **97** conexiones útiles del contenedor (`max_connections=100` menos 3 reservadas), de modo que el benchmark no era coherente con su servidor aunque nunca llegara a usar tantas | A1: la API del benchmark usa el pool de la plantilla del host (22); suma declarada 85 de 97; precondición de presupuesto que falla sin medir y veredicto `conexiones` | Corregido en el benchmark |
| (2) Drenado marginal (123,5 s frente a 120 s, programado 40322158874) | **Sin causa medida.** En 23 corridas el drenado desde la persistencia fue de 1,3 a 35,8 s (más de la mitad por debajo de 6 s), ningún consumidor superó 36 s y no hubo esperas de conexión. Solo se vieron dos lotes de 10 trabajos reintentarse una vez (hasta 61 s de latencia), sin excepción del handler en el registro del worker. El valor de 123,5 s no se reprodujo | Instrumentación permanente (drenado por consumidor, reintentos y fallos de entrega del worker en el reporte): la próxima vez que ocurra el fallo nombrará al consumidor y a su error. No se cambia el umbral | Pregunta al owner ([docs/54](54-imports-perf-questions.md), pregunta 1) |

## 2. Evidencia

### 2.1 Corridas

Todas son `nightly` por `workflow_dispatch` desde la rama no fusionada `claude/fix-imports-perf-experiments` (solo corre el job `perf`; sin aviso por issue; grupo de concurrencia propio por corrida para poder lanzarlas en paralelo sin cancelarse), PostgreSQL 18 (Testcontainers, `max_connections=100`, 3 reservadas) y runner estándar de 4 CPU (D293). La columna «Suites» es el valor del input `suites` (vacío = todas, en el orden fijo de `main`).

| Tanda | Código | Run | Suites | Persistencia (s) | Drenado desde la persistencia (s) | Pico del servidor | Worker en uso / máx. | Espera máx. de adquisición (ms) | Carga pico del host |
|---|---|---|---|---|---|---|---|---|---|
| 1 | pools por omisión (52 / 52), presupuesto no fatal | 40618458437 | todas | 209,4 | 23,3 | 32 | 21 / 52 | 73 | 7,17 |
| 1 | ídem | 40618462304 | todas | 210,5 | 6,2 | 31 | 21 / 52 | 82 | 8,24 |
| 1 | ídem | 40618465881 | `imports` sola (M4) | 92,1 | 2,0 | 30 | 21 / 52 | 41 | 5,87 |
| 1 | ídem | 40618469708 | `nightly,imports` | 211,9 | 3,7 | 30 | 21 / 52 | 72 | 7,95 |
| 2 | ídem, con reintentos | 40625111821 | todas | 213,2 | 24,6 | 30 | 21 / 52 | 51 | 9,59 |
| 2 | ídem | 40625115125 | todas | 220,2 | 32,8 | 33 | 21 / 52 | 78 | 8,35 |
| 2 | ídem | 40625118886 | todas | 233,7 | 3,0 | 32 | 21 / 52 | 65 | 8,33 |
| 2 | ídem | 40625122821 | `nightly,imports` | 208,2 | 25,1 | 30 | 20 / 52 | 67 | 8,87 |
| 2 | ídem | 40625126610 | `nightly,imports` | 214,1 | 5,2 | 30 | 20 / 52 | 71 | 9,89 |
| 2 | ídem | 40625130185 | `nightly,imports` | 204,6 | 5,0 | 30 | 21 / 52 | 61 | 7,86 |
| 3 | código final (API 22, presupuesto estricto 85 de 97) | 40630246172 | todas | 248,2 | 35,8 | 31 | 20 / 52 | 69 | 8,47 |
| 3 | ídem | 40630249531 | todas | 249,4 | 7,3 | 36 | 22 / 52 | 108 | 9,00 |
| 3 | ídem | 40630252687 | todas | 195,2 | 32,3 | 33 | 21 / 52 | 76 | 7,85 |
| 3 | ídem | 40630255932 | `nightly,imports` | 103,4 | 1,3 | 30 | 21 / 52 | 32 | 5,35 |
| 3 | ídem | 40630259122 | `nightly,imports` | 237,0 | 5,3 | 30 | 21 / 52 | 73 | 9,88 |
| 3 | ídem | 40630262240 | `nightly,imports` | 102,8 | 1,7 | 30 | 21 / 52 | 32 | 6,26 |
| 3 | ídem, sin purga (`PF_PERF_NO_PURGE=1`) | 40630771987 | `nightly,imports` | 238,4 | 4,0 | 30 | 21 / 52 | 59 | 8,55 |
| 4 | ídem, con el registro del worker | 40636074768 | todas | 223,1 | 22,6 | 33 | 21 / 52 | 80 | 8,71 |
| 4 | ídem | 40636077765 | todas | 254,0 | 17,3 | 40 | 27 / 52 | 93 | 9,37 |
| 4 | ídem | 40636081233 | todas | 203,8 | 31,2 | 36 | 21 / 52 | 78 | 7,45 |
| 4 | ídem | 40636085055 | `nightly,imports` | 129,5 | 7,4 | 30 | 18 / 52 | 54 | 8,43 |
| 4 | ídem | 40636088335 | `nightly,imports` | 233,4 | 5,3 | 30 | 21 / 52 | 68 | 8,43 |
| 4 | ídem | 40636091402 | `nightly,imports` | 212,8 | 21,2 | 30 | 21 / 52 | 64 | 7,34 |

En todas, la API llegó a 1 conexión en uso con 0 en espera y el veredicto fue `ok`. Referencia roja: programado 40322158874 (`main`, 2026-10-26): persistencia 210,7 s y drenado de 123,5 s.

Reintentos observados (a partir de la tanda 2; la tanda 3 los acota a los trabajos de la suite): las corridas 40630252687 y 40636077765 tuvieron un lote de 10 trabajos de una cola con **un** reintento y una latencia de 49–61 s (`goals.balance-watch`, `commitments.occurrence-matcher` y `planning.journal-entry-posted`). En la tanda 4, que registra el log del worker, **ninguna** corrida tiene líneas `job failed`: el reintento de ese lote no viene de una excepción del handler (que se registraría) sino de la cola (por ejemplo, un lote que vence mientras se procesa en serie). No se midió la causa.

### 2.2 Qué muestra el reporte

- **Conexiones por aplicación (pico):** `finance-worker` 21–27, `pfos-consumer` 5 (cola del worker 4 más el relay), `finance-api` 1, `pfos-producer` 1, `finance-worker-outbox-listen` 1 y el muestreador 1. Ninguna conexión de una suite anterior sigue abierta al empezar: el servidor solo muestra las aplicaciones de esta suite, 1–2 conexiones sin nombre (el propio contenedor) y el `pg_isready` del health check de Testcontainers.
- **Drenado por consumidor:** 28 colas `events.*` más el outbox. Los pendientes al terminar la persistencia son 0–1 090 por cola (los de mayor volumen, `reporting.data-version`, `debt.card-activity`, `goals.balance-watch` y `commitments.occurrence-matcher`), a 20–177 ev/s. El consumidor que cierra el drenado cambia de una corrida a otra; ninguno es sistemáticamente el más lento.
- **El outbox sin publicar** al terminar la persistencia llegó a 601 eventos en dos corridas (el relay publica por lotes) y es lo que aporta los 5–25 s de drenado de las corridas largas: las colas no se dan por drenadas hasta que el outbox está en 0.

## 3. Hipótesis

| Id | Hipótesis | Veredicto | Evidencia |
|---|---|---|---|
| HI1 | Pool lleno del lado del cliente | **Descartada** | 23 corridas: el pool del worker llega a 18–27 de 52 y el de la API a 1; `waitingCount` pico 0; espera máxima de adquisición de 108 ms frente a los 1 500 ms de `HEALTH_CHECK_TIMEOUT_MS` del harness |
| HI2 | Suma de pools máximos mayor que `max_connections` | **Aceptada como defecto de coherencia del benchmark, no como causa de un timeout.** Declarado: 115 de 97; usado: 30–40 de 100. Con 115 declarados, el error del servidor sería `sorry, too many clients`, no un timeout de adquisición | `poolsSum` y pico del servidor de cada corrida; la precondición lo detecta (TC-PLATFORM-PIPELINE-029) |
| HI3 | Conexiones de suites anteriores sin cerrar | **Descartada** | El pico por `application_name` solo contiene las aplicaciones de esta suite |
| HI4 | Conexión lenta por contención del host | **Descartada** como causa de un timeout en esta ventana | Carga pico del host de 5,4 a 9,9 (más alta que en el rojo programado, 2,7 al empezar y 5,3 al terminar) y espera máxima de 108 ms |
| HI5 | Un consumidor concreto marca el drenado | **No confirmada** | Ningún consumidor repite como el último; el máximo por consumidor fue de 35,8 s en 23 corridas. Con 123,5 s no hay medición |
| HI6 (nueva) | Un evento que se reintenta con el backoff exponencial (1, 2, 4... s hasta 3 600 s, `retryDelaySeconds` 1) alarga la cola de su consumidor hasta cruzar 120 s | **Mecanismo observado, causa no medida.** Hay lotes de 10 trabajos que se reintentan una vez con 49–61 s de latencia (40630252687 y 40636077765), pero sin línea `job failed` en el worker (tanda 4): no es una excepción del handler. Ninguna latencia se acercó a 120 s | Siete reintentos seguidos de un mismo evento suman del orden de 127 s de espera con el backoff de 1, 2, 4... s. Sin reproducción no se sabe qué reintenta el lote |
| HI7 (nueva) | E10 se produjo por el backlog de ~1,39 M de trabajos `events.*` que dejaba `nightly.perf.ts` antes de la purga (D291) | **No reproducible en el estado actual.** La corrida 40630771987 sin purga arrancó con 1 388 697 trabajos pendientes, pero `startHarness` descarta los trabajos pendientes antes de arrancar el worker (`discardStaleEventBacklog`): 30 s después quedaban 61, y la suite pasó sin esperas | E10 es anterior a la purga y se hizo desde la rama de experimentos del change 48; hoy el harness no deja que el backlog llegue al worker |

## 4. Comparación con la plantilla del host

| | Plantilla del host (D249) | Benchmark antes | Benchmark ahora |
|---|---|---|---|
| `max_connections` | 70 (3 reservadas, 67 útiles) | 100 (3 reservadas, 97 útiles) | 100 (sin cambio, A2 no aplica) |
| Pool de la API | 22 | 52 | 22 |
| Pool del worker | 34 (`DATABASE_POOL_MAX`) | 52 | 52 (sin cambio; ver abajo) |
| Colas pg-boss (API y worker, 4 c/u) | 8 (no cuentan en «API 22 + worker 34 = 56») | 8 | 8 |
| Harness o procesos auxiliares | migraciones, pgBackRest y `pf_bff` en el margen de 14 | 3 | 3 |
| Suma declarada | 22 + 34 + 8 = 64 de 67 | 115 de 97 | 85 de 97 |
| `EVENT_CONSUMER_CONCURRENCY` | 1 (`pfos.env.example`) | 4 (por omisión del código) | 4 |

Dos observaciones para la plantilla, sin cambiarla:

- **La cifra «API 22 + worker 34 = 56» omite las dos colas pg-boss** (4 cada una): el total declarado de la plantilla es 64, con 3 de margen sobre las 67 útiles. CLAUDE.md y `docs/38` §4 todavía citan «22 + 33 = 55 de 60».
- **El worker del benchmark no corre con la configuración del host.** El host fija `EVENT_CONSUMER_CONCURRENCY=1` con un pool de 34; el harness usa la concurrencia por omisión del código (4), cuya suma es de 43 consumidores en paralelo (+ 4 reservadas = 47), por eso su pool queda en 52 (con 34 el worker no arranca: `Configuración de consumidores inválida`, comprobado en local). Acercar el benchmark al host (concurrencia 1) cambiaría el ritmo de drenado que mide, y es una decisión para el owner ([docs/54](54-imports-perf-questions.md), pregunta 2).

## 5. Camino aplicado

| Opción | Estado | Nota |
|---|---|---|
| A1 pools como la plantilla | **Aplicada** (solo la API: 52 → 22) | Suma declarada 115 → 85 de 97. El worker conserva 52 porque su arranque lo exige (sección 4) |
| A2 `max_connections` del contenedor | No aplica | El uso real es de 30–40 de 100; D299 lo descarta sin una suma medida que lo pida |
| A3 cerrar pools de suites anteriores | No aplica | HI3 descartada |
| A4 timeout de adquisición propio | No aplica | HI1 y HI4 descartadas; sin configuración nueva |
| A5 concurrencia de un consumidor | No aplica | HI5 sin consumidor identificado; no se toca el presupuesto de producción ni la plantilla (D249) |

Además de A1, el change deja en la suite: la precondición de presupuesto antes de subir el archivo (TC-PLATFORM-PIPELINE-029), el muestreo de conexiones por pool y del servidor con el veredicto `conexiones` separado del de drenado (030), y el drenado por consumidor desde la persistencia con los consumidores que superan 120 s nombrados en el fallo (031 y 032), más los trabajos reintentados y los fallos de entrega del worker. El reporte los publica en `perf-results.json` (campo aditivo `imports`), en `perf-summary.md` y en el artefacto `imports-perf.json`.
