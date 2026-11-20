# 68: Preguntas abiertas tras los experimentos de la persistencia del import (change 63)

> **Fecha:** 2026-11-20 · **Change:** `stabilize-import-persist-perf` · **Evidencia:** [67](67-import-persist-perf-findings.md) · **Decisiones previas:** [64](64-import-persist-perf-decisions.md) (D403 a D409)

La causa dominante de la fila del host en rojo es la contención de CPU entre la persistencia y el trabajo concurrente del relay y de los consumidores (H3, ≈ 35 %). Ningún arreglo que no sea regular ese trabajo tiene respaldo en los datos (lotes, `synchronous_commit`, estadísticas, `VACUUM`, `CHECKPOINT` y lote del relay no cambian la persistencia). Regular exige decisiones que ni el diseño ni D403 a D409 toman del todo.

## Pregunta 1: ¿se autoriza regular el relay durante la persistencia de un import?

D406 lo permite solo si el drenado sigue ≤ 120 s y los demás eventos no se retrasan más. Medido: con el relay pausado mientras dura la persistencia el drenado fue de 8,4 a 14,7 s (≤ 120 s) y la persistencia bajó ≈ 37 % (17,2–17,7 frente a 22,0–27,7 s en el EPYC 7763). Pero pausar el relay retrasa todos los eventos del sistema, no solo los del import, durante 12–17 s, lo que contradice la segunda condición tal como está escrita.

- **Opción A (recomendada):** no regular. Mantener el relay y los consumidores intactos y decidir la pregunta 2 (tamaño del runner). Coherente con D406 y sin cambio de conducta de `platform/event-delivery`.
- **Opción B:** relay con prioridad baja solo para los eventos del propio import mientras `PERSISTING` (publicar el resto sin pausa). Cambia una conducta de `platform/event-delivery` (delta con `/opsx:update`), tiene riesgo para el orden por agregado y no está medida.
- **Opción C:** pausar todo el relay durante la persistencia. Mide bien pero retrasa cualquier evento ajeno hasta 17 s: requiere que el owner relaje la segunda condición de D406.

## Pregunta 2: ¿cuántas CPU debe tener el runner del nightly `perf`?

La contención es de CPU en 4 vCPU compartidas por Postgres, la API, el worker y el relay; en el mismo modo de trabajo el EPYC 7763 tarda 1,7× lo que el 9V45. D408 dejó el runner sin decidir mientras queden otras causas; la causa que queda es H3 más el nivel del runner.

- **Opción A (recomendada):** mantener `ubuntu-latest` y el criterio de D403 (5 programados seguidos ≤ 20 s); con la probabilidad actual de la fila del host (2 de 3 corridas en rojo con el relay sano (11-17, 11-19 dispatch; verde el 11-19 programado)) no se cumplirá sin otra palanca.
- **Opción B:** runner de 8 CPU (hosted de pago) solo para el job `perf`: cambia D302 y el costo.
- **Opción C:** medir la persistencia del host con los consumidores de la ráfaga detenidos como en la fase A de `throughput.perf.ts`. Cambia lo que mide la fila bloqueante de TC-IMPORTS-CSV-029; está fuera de lo permitido sin una decisión explícita (no se cambian las aserciones).

## Pregunta 3: ¿se mide el peso de los disparadores del ledger (D404) antes de decidir el ADR?

La condición de D404 (disparadores por sentencia solo con ≥ 25 % del lote y un ADR) no tiene medición: el experimento `track_functions` no recogió `pg_stat_user_functions`. Costo: un experimento más de ≈ 1 h.

- **Opción A (recomendada):** sí, una corrida con `track_functions = 'pl'` que lea `pg_stat_user_functions` por función; solo si la cifra pasa de 25 % se escribe el ADR.
- **Opción B:** no; la persistencia queda explicada por H3 y H1 y no se toca el ledger.
