# 81: Decisiones del owner sobre la calibración de los gastos atípicos

> **Fecha:** 2026-11-25 · **Preguntas:** [docs/80](80-anomaly-calibration-questions.md) (1 a 3) · **Change:** 85 [`refine-spending-anomaly-calibration`](../openspec/changes/refine-spending-anomaly-calibration/design.md) · **Relacionado:** D473, D483 y D488 ([docs/77](77-phase-9-and-card-interest-decisions.md)), [docs/38](38-estado-y-pendientes.md), [docs/03](03-openspec-strategy.md) §7

El owner contestó el 2026-11-25, en el chat: la pregunta 1 con la opción (a), la 2 con la opción (b) y la 3 no la contestó (no bloquea y sigue con su recomendación).

## Numeración

Los ids siguen al último usado en `origin/main`: D512 (docs/79). Este documento usa **D513–D515**.

## Decisiones

| Id | Pregunta de docs/80 | Decisión | Efecto |
|---|---|---|---|
| D513 | 1: método y parámetros por omisión | (a) La contraparte de un gasto se compara **solo contra sus gastos de la misma categoría principal** (la de la porción de mayor monto; con empate, la primera; sin contar «sin categoría»), con puntaje robusto ≥ **15**, razón ≥ 3, historia ≥ 8 y percentil **99.5** para la contraparte nueva. Los cuatro siguen configurables por variable de entorno. | Change 85, grupos 2 y 4: `ExpenseHistoryIndex.counterpartyInCategory`, `DEFAULT_ANOMALY_THRESHOLDS` y valores por omisión de `FORECASTING_ANOMALY_ROBUST_Z` (15) y `FORECASTING_ANOMALY_NEW_COUNTERPARTY_PERCENTILE` (99.5). El motivo `COUNTERPARTY_OUTLIER` informa la categoría principal en `categoryId`. Rollback por configuración: `FORECASTING_ANOMALY_ROBUST_Z=3.5` y `FORECASTING_ANOMALY_NEW_COUNTERPARTY_PERCENTILE=95` devuelven los umbrales de D473. |
| D514 | 2: criterio de salida revisado de D483 | (b) La fila del nightly con el Large Seed a escala completa vuelve a ser **bloqueante** con **precisión ≥ 0.80 y recall ≥ 0.85**, y el informe agrega los marcados sin etiqueta por criterio y los umbrales usados. **Revisa D483** (0.60 y 0.70) y **levanta la fila informativa de D488**. | Change 85, tareas 3.1 y 5.2: `MIN_PRECISION` 0.80 y `MIN_RECALL` 0.85, `anomalies.perf.ts` bloqueante, informe con `unlabeledByCriterion` y `thresholds`, runner con umbrales por argumento. La tasa de descarte con los datos reales (tarea 7.4 del change 72) sigue aparte. |
| D515 | 3: anomalías moderadas en el Large Seed | Sin respuesta del owner; sigue la recomendación (a): dejar el seed como está y confirmar el punto de corte con la tasa de descarte de su historia real. No bloquea. | Sin cambio de código. Si el owner pide más aviso con su historia real, baja `FORECASTING_ANOMALY_ROBUST_Z` hacia 10 (tarea 7.4 del change 72). Cambiar el seed afectaría a todos los benchmarks que lo usan y queda fuera. |

## Qué cambia en la práctica

- **Pendiente del owner:** confirmar el punto de corte con la tasa de descarte de su historia real (D515, tarea 7.4 del change 72).
- **Archivo:** el change 85 se archiva **después** del 72, que espera esa tarea 7.4.
