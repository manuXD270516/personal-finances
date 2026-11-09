# 63: Preguntas al owner del change 63 (`stabilize-import-persist-perf`)

> **Fecha:** 2026-11-09 · **Relacionado:** [change `stabilize-import-persist-perf`](../openspec/changes/stabilize-import-persist-perf/design.md), [03-openspec-strategy.md](03-openspec-strategy.md) §7, [38-estado-y-pendientes.md](38-estado-y-pendientes.md), [53](53-imports-perf-findings.md), [59](59-consumer-throughput-findings.md), decisiones D152, D291, D300, D302, D311, D312, D359 y D360

El owner decidió el 2026-11-09 tratar en un change aparte el fallo recurrente de la persistencia del import de 5 000 filas en el nightly, **sin tocar el umbral de 20 s** (NFR-PERF-007, D152). Estas preguntas no reabren esa decisión: definen cuándo se da por estable y qué palancas del producto se pueden usar si los experimentos las piden.

**Resumen de la evidencia** (design.md §Contexto): en el mismo commit (`7d825710`) la persistencia pasó de 14,4 s a 32,7 s entre el 2026-11-03 y el 2026-11-04, con un runner 2,28 veces más lento según la evaluación de reglas en memoria (123 ms frente a 54 ms). Entre 8 corridas, la correlación entre la velocidad del runner y la persistencia es r = 0,88; dividida por ese factor, la persistencia queda en 11–17 s, salvo el 2026-11-08 (19,9 s con un runner de referencia), primera corrida con #216, que también estancó la preparación de `throughput.perf.ts`.

| # | Pregunta | Bloquea |
|---|---|---|
| 1 | Criterio de salida y margen | El cierre del change (tarea 8.1), no el arranque |
| 2 | Disparadores de integridad por sentencia | Solo la tarea 7.6, si P5 los señala |
| 3 | Confirmación asíncrona en los lotes del import | Solo la tarea 7.6, si P7 la señala |
| 4 | Regular el relay o los consumidores durante un import | Solo la parte de regulación de la tarea 7.3, si P4 la señala |
| 5 | Huella del runner: informativa o con efecto en el veredicto | No |
| 6 | Runner del job `perf` (D302) | No; solo si tras los experimentos queda en pie únicamente la varianza del runner |
| 7 | Tarea 5.2 del change 52 | No bloquea este change; bloquea el archivado del 52 |

## 1. ¿Cuándo se da por estable la persistencia y con qué margen?

**Contexto.** El umbral sigue en 20 s. El change 52 se dio por bueno con 2 nightlies (su tarea 5.2), y aun así falló a la semana. Los runners estándar varían entre 1,0 y 2,3 veces (los del 2026-11-05 al 2026-11-07 fueron 1,6 veces más lentos). Con 14–17 s en un runner de referencia, cualquier runner de factor ≥ 1,4 lleva la persistencia por encima de 20 s. Un **objetivo de diseño** interno (no es un umbral, no lo verifica ningún test) guía hasta dónde optimizar.

**Opciones.**

- **(a)** 5 nightlies programados seguidos con la fila del host ≤ 20 s, y objetivo de diseño ≤ 12 s en un runner de factor 1,0 (soporta un runner 1,65 veces más lento, como los del 2026-11-05 al 2026-11-07).
- **(b)** 5 nightlies seguidos y objetivo ≤ 8,5 s en un runner de factor 1,0 (soporta el peor observado, 2,28 veces). Probablemente exige las palancas de las preguntas 2–4.
- **(c)** 3 nightlies seguidos ≤ 20 s, sin objetivo de diseño.

**Recomendación: (a).** Cubre los runners lentos frecuentes con optimizaciones que no requieren cambiar invariantes ni durabilidad; (b) persigue un caso raro (1 de 8 corridas) a un costo alto, y (c) repetiría lo que pasó con el change 52.

## 2. ¿Se pueden pasar los disparadores de integridad del ledger de por fila a por sentencia?

**Contexto.** Los disparadores que validan cada asiento (cuadre por moneda, asiento con movimientos, periodo abierto, suma de los splits; INV-004, INV-005, INV-015, INV-021) se ejecutan por fila también con las inserciones multi-fila del change 52. Su design dejó escrito que, si fueran el cuello de botella, se preguntaría antes de tocarlos. El experimento P5 mide su peso con `track_functions`. La variante por sentencia (con tablas de transición) valida lo mismo una vez por sentencia; la barrera se mantiene, cambia su forma.

**Opciones.**

- **(a)** Permitida solo si P5 muestra que los disparadores pesan ≥ 25 % del lote, con un ADR, los tests de integridad del ledger (un asiento descuadrado inyectado revierte el lote) y la equivalencia del change 52 en verde.
- **(b)** No permitida: los disparadores quedan por fila.

**Recomendación: (a).** La invariante no cambia y queda probada; sin evidencia de peso no se toca.

## 3. ¿Se puede confirmar de forma asíncrona (`synchronous_commit = off`) solo en las transacciones de lote del import?

**Contexto.** Cada lote confirma y espera el `fsync` del WAL. Con confirmación asíncrona, ante una caída del servidor de base se pueden perder las confirmaciones de los últimos cientos de milisegundos; el import quedaría en `PERSISTING` con esos lotes revertidos de forma consistente (filas preparadas, transacciones y progreso en la misma transacción) y se reanudaría. Es una regla de durabilidad de datos financieros. P7 solo mide su efecto en la rama de experimentos.

**Opciones.**

- **(a)** No permitida: toda escritura financiera confirma de forma síncrona.
- **(b)** Permitida solo para los lotes del import, con un ADR y una prueba de reanudación tras una caída simulada.

**Recomendación: (a).** La ganancia esperada se obtiene casi igual con menos confirmaciones (lotes más grandes, ya permitido por la decisión 4 del change 52) sin relajar la durabilidad.

## 4. ¿Se puede regular el relay o a los consumidores mientras se persiste un import?

**Contexto.** Con la configuración del host, el relay encola ≈ 90 000 trabajos y los consumidores de la ráfaga procesan mientras se persiste, en las mismas 4 CPU. La fase A de `throughput.perf.ts`, con los consumidores detenidos, persiste en 12,0–12,7 s frente a 14,4–17,1 s de la fila del host en runners de referencia. Frenar el relay o los consumidores durante la persistencia acelera el import pero retrasa los eventos: NFR-PERF-008 pide un retraso p95 ≤ 5 s del outbox al consumidor, y D312 un drenado ≤ 120 s por consumidor tras la persistencia. Un lote del relay más grande (menos transacciones, sin cambiar el orden por agregado) no es regulación y no requiere esta decisión.

**Opciones.**

- **(a)** Permitida solo si el drenado tras la persistencia sigue ≤ 120 s por consumidor y el retraso de los eventos ajenos al import no empeora, medido en el mismo nightly.
- **(b)** No permitida.

**Recomendación: (a).** Los hechos de un import grande ya llegan en ráfaga y el presupuesto de 120 s lo contempla; la condición protege a los demás eventos.

## 5. ¿La huella del runner es solo informativa?

**Contexto.** El change publica la huella del runner (CPU, memoria, calibración de CPU y de confirmaciones) con su factor frente a una referencia. Podría usarse para no aprobar una medición en un runner degradado, pero eso se parece a relajar el umbral.

**Opciones.**

- **(a)** Solo informativa: nunca repite, invalida ni corrige una medición (lo que redacta hoy el delta).
- **(b)** Si el factor es ≥ 1,5, la fila del host se repite una vez en el mismo job y decide la repetición.
- **(c)** Si el factor es ≥ 1,5, veredicto `runner degradado` que no decide (como `interferencia`).

**Recomendación: (a).** El margen debe venir del producto (pregunta 1); (b) y (c) se pueden reconsiderar con la evidencia de P1–P3 si el producto ya cumple el objetivo de diseño y solo fallan los runners extremos. Elegir (b) o (c) requiere actualizar el delta antes de implementar.

## 6. ¿Se cambia el runner del job `perf`? (condicional)

**Contexto.** D302 fijó el runner estándar de 4 CPU y volver a preguntar solo si el job se acerca a 240 min (hoy ≈ 55 min). Esta pregunta solo aplica si, tras los experimentos, la varianza del runner (H1) es la única causa en pie y el producto no alcanza el objetivo de la pregunta 1.

**Opciones.**

- **(a)** Mantener el runner estándar y documentar los fallos en runners extremos con la huella.
- **(b)** Runner más grande de GitHub (pago) solo para el job `perf`.
- **(c)** Mover el job `perf` al VPS N1 (descartado por D302).

**Recomendación: no decidir ahora; (a) por omisión** hasta tener P1–P3.

## 7. ¿Cómo se cierra la tarea 5.2 del change 52?

**Contexto.** El change 52 (`add-bulk-imported-transactions`) está implementado y fusionado (#192) pero sin archivar: su tarea 5.2 pide dos nightlies programados seguidos con la persistencia ≤ 20 s, que es la misma evidencia que el criterio de salida de este change. Mientras no se archive, sus deltas de `transactions/transaction-recording` e `imports/import-pipeline` no llegan a las specs principales y `add-import-pipeline` (54) también espera (se archiva después del 52).

**Opciones.**

- **(a)** Marcar la 5.2 `[x]` con una nota que traslada la evidencia al change 63 y archivar el 52 ya.
- **(b)** Mantener el 52 abierto hasta que el change 63 cumpla su criterio de salida.

**Recomendación: (a).** El código del 52 no cambia de contrato en este change y sus requirements son de conducta (escritura por conjunto, mismos efectos), no de tiempo; el tiempo lo sigue la fila bloqueante, que este change estabiliza.

## Respuestas

Respondidas el 2026-11-09 en [docs/64](64-import-persist-perf-decisions.md) (pregunta N → D(402+N)): el owner aceptó la recomendación de las 7 preguntas, D403 a D409.
