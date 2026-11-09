# 64: Decisiones del owner del change 63 (`stabilize-import-persist-perf`)

> **Fecha:** 2026-11-09 · **Relacionado:** [63-import-persist-perf-questions.md](63-import-persist-perf-questions.md) (pregunta N → D(402+N)), [change `stabilize-import-persist-perf`](../openspec/changes/stabilize-import-persist-perf/design.md), [03-openspec-strategy.md](03-openspec-strategy.md) §7, [38-estado-y-pendientes.md](38-estado-y-pendientes.md)

El owner aceptó las recomendaciones de las 7 preguntas de docs/63. Ninguna reabre el umbral de 20 s de NFR-PERF-007 (D152). Cualquiera es revertible antes de que se implemente la tarea que la usa.

| ID | Pregunta | Decisión |
|---|---|---|
| D403 | Q1 Criterio de salida y margen | Se acepta (a): 5 nightlies programados seguidos con la fila del host ≤ 20 s, con huella del runner publicada en cada uno, y objetivo de diseño interno ≤ 12 s en un runner de factor 1,0 (no es un umbral: la fila sigue decidiéndose solo frente a 20 s). Bloquea el cierre (tarea 8.1), no el arranque. |
| D404 | Q2 Disparadores de integridad del ledger por sentencia | Se acepta (a): permitida solo si P5 muestra que los disparadores pesan ≥ 25 % del lote, con un ADR, los tests de integridad del ledger (un asiento descuadrado inyectado revierte el lote) y la equivalencia del change 52 en verde. Sin esa evidencia los disparadores quedan por fila. Solo afecta la tarea 7.6. |
| D405 | Q3 Confirmación asíncrona (`synchronous_commit = off`) en los lotes del import | Se acepta (a): no. Toda escritura financiera confirma de forma síncrona. La ganancia se busca con menos confirmaciones (lotes más grandes, ya permitido por la decisión 4 del change 52). P7 puede medir la variante solo para acotar el peso de la espera del WAL; no se adopta. |
| D406 | Q4 Regular el relay o los consumidores durante un import | Se acepta (a): permitida solo si el drenado tras la persistencia sigue ≤ 120 s por consumidor y el retraso de los eventos ajenos al import no empeora, medido en el mismo nightly. Solo afecta la parte de regulación de la tarea 7.3. |
| D407 | Q5 Huella del runner | Se acepta (a): solo informativa. Nunca repite, invalida ni corrige una medición ni cambia un veredicto (lo que redacta el delta). Elegir (b) o (c) exigiría actualizar el delta antes de implementar. |
| D408 | Q6 Runner del job `perf` (D302) | No se decide ahora. Se mantiene el runner estándar (a) por omisión; la pregunta se reabre solo si, tras P1–P3, la varianza del runner (H1) es la única causa en pie y el producto no alcanza el objetivo de D403. |
| D409 | Q7 Cierre de la tarea 5.2 del change 52 | Se acepta (a): se marca `[x]` con una nota que traslada la evidencia al change 63 (su criterio de salida, D403) y el change 52 se archiva en un PR aparte. El change 63 no toca `openspec/changes/add-bulk-imported-transactions`. |
