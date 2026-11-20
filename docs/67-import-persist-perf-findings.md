# 67: Informe de la persistencia del import de 5 000 filas (change 63, `stabilize-import-persist-perf`)

> **Fecha:** 2026-11-20 · **Change:** `stabilize-import-persist-perf` (D403 a D409) · **Rama de experimentos (no fusionada):** `claude/import-persist-perf-experiments` · **Relacionado:** [53](53-imports-perf-findings.md), [59](59-consumer-throughput-findings.md), [63](63-import-persist-perf-questions.md), [64](64-import-persist-perf-decisions.md), [68](68-import-persist-perf-questions-2.md)

Pesos de H1 a H8 con datos de los nightlies programados (instrumentación del #224) y de seis experimentos `workflow_dispatch` sobre la rama de experimentos. El umbral de 20 s no cambia. «Host» = fila bloqueante de `imports.perf.ts` (`EVENT_CONSUMER_CONCURRENCY=1`, pool 34); «código» = fila informativa.

## 1. Nightlies programados (P1)

Job `perf`, del 13 al 19 de noviembre (runs 43441734393, 43598836373, 43720497188, 43895344740, 44117943507, 44335387686, 44441471740 y 44555579412).

| Run | Commit | Runner (CPU ms / confirmaciones por s) | Host (s) | Código (s) | Drenado del host | Fase A de `throughput.perf.ts` |
|---|---|---|---|---|---|---|
| 11-13 (43441734393) | `c14f1c66` | Xeon, 49 / 10 477 | 14,2 | 14,8 | no llegó a 0 en 180 s | completa |
| 11-14 (43598836373) | `c14f1c66` | EPYC 9V74, 52 / 5 623 | 7,6 | 16,7 | no llegó | «sin completar» |
| 11-15 (43720497188) | `c14f1c66` | EPYC 9V45, 37 / 9 291 | 4,8 | 12,5 | no llegó | completa |
| 11-16 (43895344740) | `c14f1c66` | Xeon, 48 / 10 194 | 5,9 | 15,2 | no llegó | «sin completar» |
| 11-17 (44117943507) | `21439318` | EPYC 9V74, 55 / 5 202 | **23,0** | 23,8 | 12,1 s | completa |
| 11-18 (44335387686) | `beaeda40` | EPYC 7763, 73 / 3 860 | 9,9 | 26,6 | no llegó | completa |
| 11-19 dispatch (44441471740) | `7a2b114d` (#237) | EPYC 9V74, 53 / 5 420 | **22,9** | 25,1 | 1,1 s | completa |
| 11-19 programado (44555579412) | `62e12976` | EPYC 9V74, 56 / 6 372 | 12,8 | 26,0 | 5,7 s | completa |

Lectura:

- **H7 (estancamiento del relay): resuelta.** Hasta el 11-16 y el 11-18 el outbox del import no llegaba a 0 (el relay avanzaba a ≈ 115–200 eventos/s o nada); desde el #237 (`DISTINCT ON` en la cabeza por agregado) el drenado del host baja a 1,1 y 5,7 s y la fase A y la B se completan. Con el relay detenido de hecho, la persistencia medía 5–14 s porque no había nada que compitiera con ella: al repararlo apareció la contención real (sección 3). Verificación con `throughput.perf.ts` ×3 en el mismo job (run 44649199678): persistencia de la fase A 13,6; 14,1 y 13,7 s, drenado total 19,3; 19,4 y 19,8 s, sin ninguna suite «sin completar».
- **La fila del host en rojo (20 s) del 11-19** y el rojo del 11-17 (23,0 s) ocurren con el relay sano. El run programado del 11-19 (12,8 s) pasó con los consumidores sin trabajar durante la persistencia (pico de 15 600 trabajos encolados sin consumir, frente a 2 000–3 400 en los rojos): ver la bimodalidad en la sección 3.
- **H8 (espera inicial y observación): descartada.** Espera inicial 10–23 ms y observación 67–493 ms en las 16 filas (≤ 2,5 % de la persistencia).
- **H2 (trabajos programados ajenos): descartada para `cash-flow-watch`.** Con el aislamiento del #224 la lista de trabajos programados de la ventana del host está vacía en los 8 nightlies.

## 2. Experimentos (rama `claude/import-persist-perf-experiments`)

Cada variante se repite 2–4 veces en el mismo job, entrelazadas por pasada. Persistencia del host en segundos por repetición.

| Job (run) | Runner | Variante | Repeticiones (s) |
|---|---|---|---|
| A (44649169232) | EPYC 7763 (74 ms) | host | 22,0 · 27,1 · 27,7 |
| | | consumidores de la ráfaga detenidos | 12,6 · 18,3 · 18,9 |
| | | relay pausado durante la persistencia | 17,2 · 17,7 · 17,3 |
| | | código (concurrencia 4, pool 52) | 26,6 · 33,0 · 25,5 |
| B (44649184440) | EPYC 9V74 (51 ms) | host | 13,4 · 16,4 · 21,5 |
| | | lotes de 500 | 17,2 · 21,2 · 21,8 |
| | | lotes de 1 000 | 20,8 · 20,8 · 21,9 |
| | | `track_functions = 'pl'` | 20,2 · 20,6 · 22,4 |
| | | `synchronous_commit = off` | 20,5 · 21,3 · 22,7 |
| | | sin refresco de estadísticas (#205) | 16,0 · 23,2 · 20,8 |
| | | sin el recolector ni el muestreador | 20,3 · 14,4 · 20,6 |
| C (44649214820, suite completa en orden) | Xeon (45 ms) | host | 12,0 · 20,1 |
| | | consumidores detenidos | 9,4 · 12,8 |
| | | relay pausado | 11,8 · 10,5 |
| D (44651996652) | EPYC 9V45 (34 ms) | host | 10,0 · 15,4 · 16,4 · 16,6 |
| | | `VACUUM (ANALYZE)` de toda la base antes de medir | 16,3 · 16,6 · 16,8 · 17,0 |
| | | `ANALYZE` de toda la base | 16,1 · 16,1 · 15,9 · 16,6 |
| | | `CHECKPOINT` | 15,9 · 16,6 · 9,9 · 13,3 |
| E (44652012288) | EPYC 7763 (74 ms) | host | 27,2 · 27,8 · 28,4 · 21,8 |
| | | `CHECKPOINT` | 21,9 · 26,8 · 21,3 · 28,2 |
| | | `VACUUM (ANALYZE)` | 27,3 · 27,4 · 28,5 · 29,1 |
| | | relay con lote de 1 000 (por omisión 200) | 21,2 · 28,1 · 28,4 · 28,3 |

## 3. Pesos y veredicto por hipótesis

La persistencia es bimodal dentro de un mismo runner: un modo «rápido» (comisiones de lote de 2–3 s) y uno «lento» (9–17 s), y la diferencia es de 30–40 %. El modo rápido coincide con corridas en que los consumidores de la ráfaga no estaban procesando mientras se persistía (picos de 7 200 a 13 100 trabajos encolados sin consumir, p. ej. D #3 y E #4); el lento, con los consumidores y el relay activos (2 000–4 600 encolados). Es compatible con una contención por CPU de las 4 CPU compartidas (carga 1 min de 3,7 a 5,1), no con el disco.

| Hipótesis | Peso medido | Veredicto | Evidencia |
|---|---|---|---|
| H3 contención del relay y los consumidores | ≈ 35 % (6–10 s) por componente, con solapamiento | **Aceptada (dominante)** | Consumidores detenidos −35 % (A) y −22 %/−36 % (C); relay pausado −37 % (A) y −2 %/−48 % (C). Desde el #237 el relay y los consumidores compiten con la persistencia; el lote del relay de 1 000 no cambia nada (E: 21,2–28,3 frente a 21,8–28,4): el costo no está en el tamaño del lote del relay |
| H1 varianza del runner | ≈ 1,7× entre EPYC 7763 y 9V45 en el mismo modo (27 s frente a 16 s), no explica la dispersión dentro del runner | **Aceptada en parte**: fija el nivel; la normalización por factor no cierra en ± 15 % | La dispersión intra-runner (host B: 13,4 a 21,5 s, 46 %) es comparable a la inter-runner, contra la predicción de ≤ 10 % |
| H6 confirmaciones y disco | < 5 % | **Descartada** | `synchronous_commit = off` no baja nada (B: 20,5–22,7 frente a 13,4–21,5); `CHECKPOINT` tampoco |
| H4 costo fijo por lote | < 5 % | **Descartada** | Lotes de 500 y 1 000 no son más rápidos (B); lectura, vínculos y guardado del job suman ≈ 0,7 s de 12 |
| H5 estado de la base | < 3 % | **Descartada** | `VACUUM (ANALYZE)`, `ANALYZE` y `CHECKPOINT` previos no cambian la persistencia (D y E); el mantenimiento dentro de la ventana es de 250 ms a 2 s |
| H2 trabajos programados / #205 | 0 | **Descartada** | 0 trabajos ajenos en la ventana en 8 nightlies; sin el refresco de estadísticas, 16,0–23,2 s frente a 13,4–21,5 s |
| H7 estancamiento del relay | resuelta | **Aceptada y resuelta (#237)** | Sección 1 |
| H8 espera inicial y observación | ≤ 2,5 % | **Descartada** | Sección 1 |

Otros resultados: el recolector y el muestreador cuestan ≈ 7 % en promedio (18,4 frente a 17,1 s) pero dentro del ruido de ± 30 % (no se pudo acotar el ≤ 3 % de P2; sigue sin ser causa del rojo). La fila del código no es más lenta que la del host de forma sistemática (A: 26,6 frente a 27,1 s).

## 4. Qué no se hizo y por qué

- **P3 con pares `7d825710` frente a `main`:** las dos causas que nombra H2 ya están excluidas por medición directa (sin trabajos programados en la ventana; sin el refresco de #205 no baja).
- **Disparadores por sentencia (D404, tarea 7.6):** la condición es que `track_functions` muestre ≥ 25 % del lote. No se recogió `pg_stat_user_functions` en la variante; la comisión rápida (2–3 s de 10 s) es una cota superior que incluye los disparadores diferidos más la confirmación, no una medición. Queda sin evidencia.
- **Arreglos de producto:** ninguno de los aceptados (H3) tiene un arreglo dentro de lo decidido; ver [68](68-import-persist-perf-questions-2.md).

## 5. Peso de los disparadores del ledger (D404 y D445, 2026-11-20)

Variante `track_functions = 'pl'` con `pg_stat_reset()` antes de aprobar y lectura de `pg_stat_user_functions` al terminar la persistencia de la fila del host; runs 44689564779 (Xeon, 47 ms) y 44689580742 (EPYC 7763, 80 ms), 3 repeticiones cada uno entrelazadas con la variante `host`. Peso = tiempo propio (`self_time`) de las funciones de disparador dividido por la persistencia de esa misma repetición.

| Run | Repetición | Persistencia (s) | Disparadores (s) | Peso |
|---|---|---|---|---|
| 44689564779 | 1 | 15,5 | 7,6 | 49 % |
| 44689564779 | 2 | 13,9 | 5,3 | 38 % |
| 44689564779 | 3 | 19,1 | 11,4 | 60 % |
| 44689580742 | 1 | 21,1 | 5,6 | 27 % |
| 44689580742 | 2 | 18,7 | 4,9 | 26 % |
| 44689580742 | 3 | 27,1 | 15,9 | 58 % |

Las funciones que pesan, con llamadas por import y tiempo propio de la repetición 1 (Xeon): `txn.assert_splits_sum` (10 000 llamadas, 3,6 s), `ledger.assert_entry_balanced` (10 002, 2,2 s) y `ledger.assert_entry_has_postings` (5 001, 1,4 s); `txn.assert_transfer_consistency` y `ledger.assert_period_open` suman menos de 0,3 s. En el EPYC 7763 `txn.assert_splits_sum` es 4,7 s de 5,6.

**Resultado: peso ≥ 25 % en las seis repeticiones (26 % a 60 %).** Condición de D404 cumplida. Reservas: el tiempo propio es de reloj, así que se infla con la contención de CPU (las repeticiones del 49 % al 60 % coinciden con el modo lento de la sección 3), y `track_functions` añade su propio costo (las persistencias con la variante no son menores que las del host). Aun con ambas reservas, en el modo menos contendido el peso es del 26 al 27 %. No se implementa nada: el ADR de D404 queda como pregunta al owner ([68](68-import-persist-perf-questions-2.md), pregunta 4).

**Medición de la validación por sentencia (ADR-0034, tarea 7.6.6, 2026-11-20).** Variantes `ledger-row` y `ledger-stmt` entrelazadas ×3 en el mismo job, con `track_functions = 'pl'`: run 44706595827 (EPYC 9V45) y 44706600430 (EPYC 9V74). Tiempo propio de validación (mediana): 9,43 s → 0,48 s y 12,26 s → 0,59 s (−95 %); persistencia mediana: 16,6 s → 8,8 s (−47 %) y 21,0 s → 12,4 s (−41 %). NFR-PERF-003 (run 44706604889): sin cambios fuera del ruido (medianas de p95: gasto 40,0 / 40,1 ms, transferencia 31,6 / 30,9 ms, conversión 43,7 / 43,2 ms). Los runs 44701067797, 44701072735, 44704491048, 44704495695 y 44704500238 corresponden a versiones previas de los validadores con un plan cuadrático (colas sin estadísticas) y se descartan. Los disparadores por fila sufren un problema de plan parecido: `ledger.assert_entry_balanced` pasa de 0,013 ms por llamada en la repetición 1 a 0,6 ms desde la 2. Detalle en las Notas de [ADR-0034](adr/0034-validacion-por-sentencia-de-los-invariantes-del-ledger.md).

**Palancas que quedan para D403 (meta de 20 s):** (1) disparadores por sentencia con tablas de transición para `txn.assert_splits_sum` y `ledger.assert_entry_balanced` (D404, ADR; ahorro estimado de 3 a 8 s por import según el modo); (2) ninguna otra con respaldo: regular el relay y cambiar el runner quedaron descartadas por el owner (D443, D444) y lotes, `synchronous_commit`, estadísticas y `VACUUM` no cambian la persistencia.
