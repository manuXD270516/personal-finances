# 54: Preguntas abiertas tras el informe de `imports.perf.ts` (change 48b)

> **Estado:** Abierto, a la espera del owner · **Fecha:** 2026-10-28 · **Relacionado:** [53-imports-perf-findings.md](53-imports-perf-findings.md) (informe), [52-perf-under-load-owner-decisions.md](52-perf-under-load-owner-decisions.md) (D299–D303), change [`fix-imports-perf-connection-budget`](../openspec/changes/fix-imports-perf-connection-budget/proposal.md)

Preguntas que el informe deja sin resolver. Ninguna bloquea el cierre de lo ya corregido (presupuesto de conexiones y reporte por consumidor); la 1 condiciona el criterio de salida del change (dos nightlies programados seguidos con `imports.perf.ts` en verde). Las respuestas irán en el `…-decisions.md` siguiente, con id D304 en adelante.

## Pregunta 1: ¿qué hacemos con el drenado marginal (123,5 s frente a 120 s) que no se reproduce?

**Hecho medido.** En 23 corridas (4 + 6 + 7 + 6, [docs/53](53-imports-perf-findings.md) §2.1) el drenado desde la persistencia fue de 1,3 a 35,8 s, nunca cerca de 120 s, con persistencias de 92 a 254 s y carga del host de 5,4 a 9,9. El único valor de 123,5 s es el del programado 40322158874, que no tiene detalle por consumidor (el reporte actual no lo publicaba). Se vio el mecanismo que podría producirlo (lotes de 10 trabajos que se reintentan una vez con 49–61 s de latencia, sin excepción del handler en el registro del worker) pero no su causa ni una latencia de 120 s.

| Opción | Qué implica | Riesgo |
|---|---|---|
| (a) **Dejar el umbral y el benchmark como están y esperar la próxima ocurrencia** con el reporte nuevo (consumidor, pendientes, reintentos y fallos de entrega del worker). El job `perf` sigue bloqueante | Sin cambios de código. El criterio de salida del change (dos programados verdes seguidos) queda a la espera de las corridas reales | Un rojo intermitente puede repetirse hasta que se capture; cuesta un nightly rojo, pero ahora con evidencia |
| (b) Subir `DRAIN_BUDGET_MS` o volver informativa la fila | Quita el rojo | Contradice D112, D285 y D299; esconde un posible problema de reintentos del producto. No recomendada |
| (c) Un change dedicado a provocar el fallo (inyectar carga o fallos en los consumidores del import) | Mide la latencia de la cola con reintentos | Costo de diseño y de corridas sin evidencia de que sea el mecanismo |

**Recomendación: (a).** Es la única que respeta D299 («medir antes de corregir; el umbral no cambia») y ya deja la instrumentación que falta para convertir el siguiente rojo en una causa.

**Impacto de la respuesta:** con (a), el change se archiva con la tarea 6.2 marcada como pendiente de los programados y esta pregunta ligada al primer rojo; con (c), se abre un change aparte.

## Pregunta 2: ¿el worker del benchmark debe correr con la concurrencia del host (1) o con la del código (4)?

**Hecho medido.** El host fija `EVENT_CONSUMER_CONCURRENCY=1` y `DATABASE_POOL_MAX=34` (`deploy/host/etc-pfos/pfos.env.example`). El harness del benchmark no fija esas variables: usa la concurrencia por omisión del código (4), que suma 43 consumidores en paralelo y obliga a un pool de 52 (con 34 el worker no arranca). El drenado medido (1,3–35,8 s) corresponde por eso a un worker más rápido que el del host.

| Opción | Qué implica | Riesgo |
|---|---|---|
| (a) **Dejarlo como está y documentarlo** (el benchmark sigue midiendo con la concurrencia del código; el informe lo declara) | Sin cambios | El benchmark puede subestimar el drenado del host |
| (b) Fijar `EVENT_CONSUMER_CONCURRENCY=1` y el pool del worker en 34 en el harness del import | Mide lo que corre en producción; la suma declarada baja a 67 de 97 | Cambia lo que mide la fila: con concurrencia 1 el drenado sube y puede superar 120 s con solo el handler real (D112 exige ≥ 42 ev/s por consumidor); sería un rojo nuevo, con causa distinta |
| (c) Medir las dos configuraciones, la del host en una fila informativa | Evidencia sin riesgo para el job | Más tiempo de corrida (≈ 3 min por configuración) |

**Recomendación: (a) ahora y revisar (c) con el change `optimize-consumer-throughput` de Phase 6 (D301)**, que ya va a medir el throughput por consumidor con el handler real y cambiar el perfil de eventos del import (`RecordImportedTransactions`, D152).

## No es una pregunta: cifras desactualizadas

CLAUDE.md (sección «Código», presupuesto de conexiones) y `docs/38` §4 citan «API 22 + worker 33 = 55 sobre 60 de Postgres»; la plantilla vigente (`deploy/compose/compose.prod.yaml`, D249) es `max_connections=70` con API 22 + worker 34 = 56, y sin contar las dos colas pg-boss (4 cada una), lo que da 64 de 67 útiles. `docs/38` se corrige en este change; CLAUDE.md queda para que lo corrija quien lo mantiene.
