# 70: Decisiones del owner sobre el rendimiento del reporte de tendencias (change `fix-trends-report-perf`)

> **Fecha:** 2026-11-23 · **Anteriores:** [69](69-import-persist-perf-decisions-2.md) (D443 a D447) · **Change:** [`fix-trends-report-perf`](../openspec/changes/fix-trends-report-perf/proposal.md) · **Relacionado:** [docs/38](38-estado-y-pendientes.md), change 63 `stabilize-import-persist-perf`

El nightly programado del 2026-11-23 (run 45231166087, AMD EPYC 7763) falló solo por la fila `report-trends-24m` (`GET /reports/trends` con 24 meses calendario, NFR-PERF-006): p95 de 845 ms contra 800 ms. La misma fila mide entre 493 y 514 ms en los runners Intel Xeon 6975P-C y 772 ms en un AMD EPYC 9V74 (runs 44913986214, 45032465801 y 44760461447). El owner decidió sin un documento de preguntas previo:

| Id | Tema | Decisión | Efecto |
|---|---|---|---|
| D448 | Fila `report-trends-24m` cerca del umbral según el runner | Optimizar la consulta del reporte **sin tocar el umbral de 800 ms** de NFR-PERF-006 | Change `fix-trends-report-perf` (diseño en este PR). La fila sigue bloqueante con 800 ms; el objetivo interno del change (≤ 400 ms en un runner AMD) es criterio de cierre, no un umbral nuevo |
| D449 | Nightly programado del 2026-11-23 y el criterio de salida de D403 | El nightly 45231166087 **cuenta** para la tarea 8.1 de `stabilize-import-persist-perf`: su fila del host de TC-IMPORTS-CSV-029 pasó (persistencia de 18,6 s ≤ 20 s) y lo que falló fue la fila `report-trends-24m`, ajena a ese change | La serie de «5 nightlies programados seguidos ≤ 20 s» de D403 no se corta por un fallo del job `perf` en otra fila; se registra en la nota de la tarea 8.1 |

## Alcance de D449

D449 decide sobre el nightly del 2026-11-23: para la tarea 8.1 cuenta la fila del host de TC-IMPORTS-CSV-029 aunque el job `perf` termine en rojo por otra fila. No decide qué pasa con un nightly en el que esa fila no llegue a medirse; si el caso se presenta, se consulta al owner.
