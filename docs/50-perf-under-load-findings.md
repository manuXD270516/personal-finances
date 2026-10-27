# 50: Informe del rendimiento bajo carga del job `perf` (change 48)

> **Estado:** Registrado · **Fecha:** 2026-10-25 · **Change:** [`investigate-perf-under-load`](../openspec/changes/investigate-perf-under-load/proposal.md) (48), grupo 4 · **Relacionado:** [design del change](../openspec/changes/investigate-perf-under-load/design.md) (hipótesis H1–H7, experimentos E1–E8), [46-nightly-and-perf-owner-decisions.md](46-nightly-and-perf-owner-decisions.md) (D285, D290), [48-perf-and-rls-owner-decisions.md](48-perf-and-rls-owner-decisions.md) (D291–D293), [23-ci-cd.md](23-ci-cd.md) §5.5, [38-estado-y-pendientes.md](38-estado-y-pendientes.md), preguntas nuevas en [51-perf-under-load-questions.md](51-perf-under-load-questions.md)

Informe de la tarea 4.1: causa medida de cada síntoma del job `perf`, hipótesis aceptadas y descartadas, mediciones, camino y responsable. No cambia ningún umbral ni ninguna fila bloqueante (D285, D43); el job `perf` sigue bloqueante hasta que se apliquen los caminos.

## 1. Resumen

| Síntoma | Benchmark | Causa medida | Camino | Responsable |
|---|---|---|---|---|
| S1 | TC-COMMITMENTS-MATCH-012 (matcher, ≥ 42 ev/s, D112) | **Backlog ajeno en la cola del matcher (H1):** tras la fase de throughput de `nightly.perf.ts` quedan ~1,39 M trabajos `events.*`; el matcher de la suite procesa primero los ajenos | (a) arreglo del benchmark: purga del backlog residual tras medir el throughput (D291) y precondición de aislamiento | Change 48, grupo 5 |
| S2 | TC-REPORTING-SPENDABLE-014 y TC-PLATFORM-PIPELINE-018 (p95 ≤ 300 ms, NFR-PERF-004) | **Contención de CPU del host (H2):** la suite empieza con el host ocupado por el trabajo residual de la suite anterior (drenado de consumidores, autovacuum de `pgboss.job`) y el orden de los archivos no está fijado | (a) arreglo del benchmark: precondición de quietud del host al empezar cada suite y orden determinista de los archivos | Change 48, grupo 5 |
| S3 | Throughput por consumidor con handler real (NFR-PERF-008, informativo, D292) | **No medida por consumidor:** E6–E8 no corrieron. Se sabe que con ~1,4 M trabajos pendientes el drenado real ronda 6 ev/s y que el matcher en limpio rinde 105–175 ev/s | Sigue informativa (D292); umbral por consumidor y posible change de optimización a decidir por el owner (docs/51, preguntas 2, 3 y 5) | Owner (decisión); arquitecto (change de seguimiento si lo pide) |
| Fuera del alcance | `imports.perf.ts` | No medida: `timeout exceeded when trying to connect` y drenado que vence a los 120 s; indicio de presupuesto de conexiones (H6) | Change de seguimiento propuesto `fix-imports-perf-connection-budget` (docs/51, pregunta 1) | Owner (decisión); arquitecto (redacción) |

Conclusión: **S1 y S2 son artefactos del benchmark, no defectos del producto.** El código de disponible para gastar y el matcher cumplen con holgura en una base limpia (H7 descartada). Ningún umbral necesita cambiar: docs/02 sigue siendo la fuente y el test de política lo protege (TC-PLATFORM-PIPELINE-028).

## 2. Evidencia

### 2.1 Corridas

Todas las corridas son `nightly` por `workflow_dispatch` desde la rama no fusionada `claude/investigate-perf-under-load-experiments` (commit `03cd1ab`), con el Large Seed salvo que se diga, PostgreSQL 18 y runner estándar de 4 CPU (D293). La conclusión del workflow refleja todo el job; las filas que cita este informe se leen de `perf-summary.md` de cada corrida.

| Run | Fecha (UTC) | Experimento | Suites y orden | Fase de throughput | Purga |
|---|---|---|---|---|---|
| 40085830417 | 2026-10-24 10:25 | Programado de `main` (`55b2dc2`), referencia | todas, orden de `main` | 600 s | no |
| 40138711508 | 2026-10-24 22:28 | E1 #1 | `spendable`, `commitments`, base limpia | no aplica | no |
| 40139599002 | 2026-10-24 22:40 | E1 #2 | ídem | no aplica | no |
| 40139952726 | 2026-10-24 22:46 | E1 #3 | ídem | no aplica | no |
| 40140370835 | 2026-10-24 22:52 | E2 | `nightly`, `spendable` | no corrió (ver 2.2) | no |
| 40145258581 | 2026-10-25 00:04 | E3 | `nightly`, `spendable` | no corrió | sí |
| 40148518760 | 2026-10-25 00:54 | efull-1 | todas, `spendable` antes de `imports` | no corrió | no |
| 40153263619 | 2026-10-25 02:07 | E9 | `imports`, `spendable`, sin Large Seed | no aplica | no |
| 40154960947 | 2026-10-25 02:34 | E10 | `nightly` → `commitments` → `subscriptions` → `imports` → `spendable` (orden de `main`) | 600 s | no |
| 40160392746 | 2026-10-25 04:02 | E11 | ídem E10 | 600 s | sí, antes de cada suite |

E9 y efull-1 son variantes no previstas en el design; E10 y E11 cumplen el papel de E5 (matcher con el backlog real) y de E2/E3 con la fase de throughput completa. E4, E6, E7 y E8 no se lanzaron.

### 2.2 Nota metodológica

- En E1, E2, E3, efull-1 y E9 **la fase de throughput de `nightly.perf.ts` no corrió**: en la rama de experimentos la variable `throughput_seconds` quedaba vacía y se leía como 0. Esas corridas no dejan los ~1,39 M trabajos `events.*` que deja la fase real, así que **no sirven para reproducir S1 ni S2**, pero sí como línea base (E2 y E3 conservan el volumen del Large Seed y los 470 310 eventos del outbox sin publicar).
- **Repeticiones:** solo E1 tiene las tres repeticiones que pide el design (decisión 3). E2, E3, efull-1, E10 y E11 tienen una. Las conclusiones de S1 y S2 se apoyan en la coherencia entre corridas independientes (E1, E10, E11 y el programado de `main`), no en la mediana de cada variante; la confirmación con repetición la da la tarea 7.2 tras el grupo 5 (dos corridas seguidas, criterio de 8.2). Ver docs/51, pregunta 5.
- E9 corrió `imports` y `spendable` sin Large Seed: no representa el job real y no se usa para ninguna conclusión.

### 2.3 Mediciones

Disponible para gastar: p95 de `getReportSummary` con el bloque spendable / p95 de `getSpendable` con 300 ocurrencias (umbral 300 ms). Matcher: ev/s de la ráfaga de 1 050 eventos (umbral 42 ev/s). Carga del host: `os.loadavg()` a 1 min en la foto de arranque de la suite (4 CPU).

| Experimento | Disponible p95 (ms) | Carga al empezar `spendable` | Matcher (ev/s) | Trabajos ajenos en la cola del matcher |
|---|---|---|---|---|
| E1 ×3 | 66,87 / 56,67 · 53,2 / 50,68 · 65,26 / 54,27 | sin Large Seed | 104,6 · 142,2 · 104,8 | 0 |
| E1, mediana [mín, máx] | **65,26** [53,2, 66,87] / **54,27** [50,68, 56,67] | — | **104,8** [104,6, 142,2] | 0 |
| E2 (470 310 eventos sin publicar) | 54,5 / 42,4 | 2,9–3,5 (rango del grupo) | — | — |
| E3 (con purga: 470 310 eventos y 541 trabajos) | 75,8 / 59,1 | 2,9–3,5 (rango del grupo) | — | — |
| efull-1 (`spendable` antes de `imports`) | 77,95 / 65,87 | 2,9–3,5 (rango del grupo) | 134,9 / 140 (desde el arranque / ventana de la ráfaga) | — |
| E10 (orden de `main`, sin purga) | 66,17 / 46,19 | 3,5 (`imports` falló a los 34 s) | **no drena**: «el matcher no drenó la ráfaga a tiempo» | 1 388 832 trabajos `events.*` tras `nightly`; carga 7,56 |
| E11 (orden de `main`, purga antes de cada suite) | **210,45 / 200,53** (p50 198 / 188) | **7,5** (justo tras `imports`) | **161,12** (175 en la ventana de la ráfaga) | 0 (purgó 1 385 587 trabajos tras `nightly`) |
| Programado de `main` 40085830417 | **354 / 359** | **7,96** | ~6 | 150 560 antes de la ráfaga |

Correlación de la carga del host al empezar `spendable` con su p95, sobre las corridas con Large Seed:

| Carga a 1 min | p95 (ms) | Corridas |
|---|---|---|
| 2,9–3,5 | 46–78 | E2, E3, efull-1, E10 |
| 7,5 | 200–210 | E11 |
| 7,96 | 354–359 | `main` 40085830417 |

## 3. Hipótesis

| Id | Hipótesis | Veredicto | Evidencia |
|---|---|---|---|
| H1 | Backlog compartido en las colas | **Aceptada** (S1) | E10 reproduce S1 con 1 388 832 trabajos ajenos tras `nightly`; E11, igual pero con purga, da 161,12 ev/s con 0 trabajos ajenos; `main` falla con 150 560 trabajos en la cola del matcher; E1 en limpio, 104,8 ev/s de mediana |
| H2 | Contención de CPU en el runner de 4 CPU | **Aceptada** (S2) | Con el mismo volumen de base, el p95 sube con la carga del host al empezar: 46–78 ms con 2,9–3,5, 200–210 ms con 7,5 y 354–359 ms con 7,96. La carga viene del trabajo residual de la suite anterior (drenado de consumidores, autovacuum de `pgboss.job` con ~112 000 filas muertas tras la purga) y del orden de los archivos, que no está fijado |
| H3 | Volumen y estado de la base tras el Large Seed | **Descartada como causa por sí sola** | E2, E3 y efull-1 miden con el volumen completo del Large Seed y quedan en 42–78 ms. El autovacuum en curso (estado de la base) no se separa de H2 con estos datos: se trata como una fuente más de carga del host, que la precondición de quietud también espera. No se midió `EXPLAIN (ANALYZE, BUFFERS)` por variante. Consecuencia para la tarea 5.2: la evidencia no pide una base por suite |
| H4 | Contención de locks o índices | **No medida** | E6 no corrió. S1 y S2 quedan explicados sin ella; sigue abierta para S3 |
| H5 | Consumidores concretos lentos | **No medida** | E6 y E8 no corrieron. Abierta para S3 |
| H6 | Presupuesto de conexiones | **No medida; indicio fuera del alcance** | No explica S1 ni S2 (E11 los separa sin tocar conexiones). `imports.perf` falla con `timeout exceeded when trying to connect`: indicio para el change de seguimiento `fix-imports-perf-connection-budget` |
| H7 | Lentitud real de disponible para gastar, independiente de la carga | **Descartada** | E1 en limpio: mediana 65,26 / 54,27 ms frente a 300 ms (≈ 4,6 veces de margen). El código está sano; el rojo depende del estado del host |

## 4. Por síntoma

### S1: el matcher no drena su ráfaga (TC-COMMITMENTS-MATCH-012)

- **Causa:** H1. La fase de throughput de `nightly.perf.ts` publica el outbox del Large Seed en las colas de los consumidores (~1,39 M trabajos `events.*` en E10, por la difusión de cada evento a varios consumidores) y se cierra sin drenarlas. `commitments.perf.ts` arranca su matcher sobre la misma cola `events.commitments.occurrence-matcher`, que procesa primero el backlog ajeno, y su contador avanza a ~6 ev/s.
- **Mediciones:** en limpio, mediana 104,8 ev/s [104,6, 142,2] (E1 ×3); con la purga tras el Large Seed, 161,12 ev/s (E11); sin purga, no drena (E10, `main`).
- **Camino:** (a) arreglo del benchmark. Purga del backlog residual tras la medición de throughput (D291) y precondición de aislamiento al empezar cada suite (requirement «El benchmark nocturno mide sin interferencia de carga de fondo»). La meta de D112 no cambia.
- **Responsable:** change 48, grupo 5 (en implementación). Verificación: tarea 7.2.

### S2: p95 de disponible para gastar sobre 300 ms (TC-REPORTING-SPENDABLE-014, TC-PLATFORM-PIPELINE-018)

- **Causa:** H2. La suite mide con el host ocupado por el trabajo residual de la suite que corrió antes (en el orden de `main`, `imports`, cuyo drenado y consumidores siguen activos) y por el autovacuum de `pgboss.job`. La purga sola no basta (E11: 210,45 / 200,53 ms con carga 7,5 y cero trabajos ajenos). El backlog sin publicar del outbox no degrada la consulta por sí solo (E2: 54,5 / 42,4 ms con 470 310 eventos pendientes).
- **Mediciones:** en limpio, mediana 65,26 / 54,27 ms (E1 ×3); con Large Seed y host tranquilo, 42–78 ms (E2, E3, efull-1, E10); con host cargado, 200–359 ms (E11, `main`).
- **Camino:** (a) arreglo del benchmark. Precondición de quietud del host al empezar cada suite (esperar a que bajen la carga y el trabajo residual, con un tope, y fallar con el veredicto `interferencia` si no se alcanza) y orden determinista de los archivos de Vitest. No cambia el umbral, ni `nightly.yml`, ni agrega jobs (D291); se queda en el runner estándar (D293).
- **Responsable:** change 48, grupo 5 (en implementación). Verificación: tarea 7.2. Si la espera de quietud alarga demasiado el job, vuelve la pregunta del runner (docs/51, pregunta 4).

### S3: throughput por consumidor con handler real (NFR-PERF-008, informativo)

- **Causa:** no medida por consumidor. E6–E8 (muestreo de locks, duración por evento, un consumidor a la vez y handler trivial) no se lanzaron. Se sabe: con ~1,4 M trabajos pendientes el drenado con handlers reales ronda 6 ev/s (0,04–9 ev/s por consumidor en la corrida 39669892721); el mismo matcher en limpio rinde 105–175 ev/s y NFR-PERF-008 con handler trivial se cumple en integración (TC-PLATFORM-EVENTS-014).
- **Camino:** la fila sigue informativa (D292). Si el owner quiere una meta con handler real, (d) change de optimización `optimize-consumer-throughput` que empiece midiendo E6–E8 y proponga el umbral por consumidor (docs/51, preguntas 2 y 3).
- **Responsable:** owner (decisión); arquitecto (redactar el change si lo pide).

### Otros rojos del nightly

- **`imports.perf.ts`:** falla con `timeout exceeded when trying to connect` y con `until: timeout` del drenado a 120 s (en E10 falló a los 34 s). No es uno de los síntomas del change. Indicio de agotamiento de conexiones del pool frente al presupuesto API 22 + worker 33 = 55 de 60 (CLAUDE.md), sumado a las conexiones del harness. Camino: change de seguimiento `fix-imports-perf-connection-budget` (docs/51, pregunta 1). La persistencia ≤ 20 s del import sigue diferida (D152).
- **Throughput informativo (NFR-PERF-008):** sin cambio de política (D292).

## 5. Lo que este informe no cambia

- Ningún umbral de docs/02 ni ninguna fila bloqueante (D43, D285). El test de política (TC-PLATFORM-PIPELINE-028) los sigue fijando.
- Ningún código de producción: los dos caminos de S1 y S2 viven en el harness `apps/api/test/perf/`.
- La medición de throughput con el backlog completo se conserva (S3 mide la carga real); la purga y la quietud solo evitan que contamine a las suites siguientes.

## 6. Changes de seguimiento propuestos

| Nombre propuesto | Alcance | Estado |
|---|---|---|
| `fix-imports-perf-connection-budget` | Medir las conexiones de `imports.perf.ts` (pools de la API, del worker y del harness frente a `max_connections` del contenedor) y corregir el benchmark o el producto según la causa | Redactado (D299, [docs/52](52-perf-under-load-owner-decisions.md)), con el alcance ampliado al drenado marginal (123,5 s frente a 120 s, programado 40322158874) |
| `optimize-consumer-throughput` | Medir E6–E8 por consumidor con handler real, proponer el umbral por consumidor (D292) y optimizar los consumidores lentos | Diferido a Phase 6 con la escritura masiva del import (D300, D301, [docs/52](52-perf-under-load-owner-decisions.md)) |
