# 80: Preguntas sobre la calibración de los gastos atípicos y el criterio de D483

> **Fecha:** 2026-11-25 · **Decisión de origen:** D488 ([docs/77](77-phase-9-and-card-interest-decisions.md)) · **Change:** 85 [`refine-spending-anomaly-calibration`](../openspec/changes/refine-spending-anomaly-calibration/design.md) · **Relacionado:** [docs/38](38-estado-y-pendientes.md), change 72 [`add-spending-anomaly-detection`](../openspec/changes/add-spending-anomaly-detection/design.md)

## Contexto

Con los parámetros de D473, la detección de gastos atípicos marca casi todo lo que no es habitual. Contra las anomalías etiquetadas del Large Seed a escala completa (92 146 gastos evaluados, 123 etiquetados `OUTLIER` o `NEW_COUNTERPARTY_FRAUD`) marca 8 553 gastos: recall 0.9919 y precisión 0.0143, lejos de D483 (precisión ≥ 0.60 y recall ≥ 0.70). Por D488 la fila del nightly ya es informativa y se corrió una rejilla de 2 100 combinaciones a escala completa y a escala 0.1 (unos 150 gastos por mes, parecido al volumen de una persona). La tabla completa y el método están en el design del change 85.

Resumen (P = precisión, R = recall):

| Variante | Escala completa | Escala 0.1 |
|---|---|---|
| D473 (hoy): z ≥ 3.5, percentil 95 | P 0.0143, R 0.9919 | P 0.0377, R 1.0000 |
| Solo parámetros, mejor fila: z ≥ 30, historia ≥ 20, percentil 99.5 | P 0.8609, R 0.8049 | P 1.0000, R 0.3333 |
| Contraparte en su categoría, z ≥ 10, percentil 99.5 | P 0.8561, R 0.9675 | P 0.5217, R 1.0000 |
| **Contraparte en su categoría, z ≥ 15, percentil 99.5 (recomendada)** | **P 0.9355, R 0.9431** | **P 0.8000, R 1.0000** |

El ruido viene sobre todo del criterio por contraparte (6 807 de los 8 427 marcados sin etiqueta): compara gastos de categorías distintas del mismo comercio. Ningún umbral lo corrige sin hundir el recall con poco volumen.

Las preguntas 1 y 2 bloquean la implementación del change 85 (grupos 2 y 3, y la tarea 5.2). Mientras tanto la fila del nightly sigue informativa. La 3 no bloquea.

## Preguntas

### 1. [B para el change 85] Método y parámetros por omisión

- (a) **Contraparte comparada dentro de su categoría principal (la de la porción de mayor monto), puntaje robusto ≥ 15, razón ≥ 3, historia ≥ 8 y percentil 99.5 para la contraparte nueva.** Precisión y recall altos a las dos escalas. Solo marca gastos muy fuera de lo habitual: en el seed, z ≥ 15 equivale a unas 9.5 a 14 veces la mediana de la categoría.
- (b) Lo mismo con puntaje robusto ≥ 10: marca desde unas 7 a 10 veces la mediana y sube el recall (0.97), pero con el volumen de una persona la precisión baja a 0.52 (uno de cada dos avisos sería ruido).
- (c) Solo parámetros, sin cambiar el método (z ≥ 30, historia ≥ 20, percentil 99.5): no toca código, pero con el volumen de una persona detecta 1 de cada 3 anomalías.

**Recomendación: (a).** Es la única que se sostiene a las dos escalas. Los cuatro parámetros siguen configurables, así que con la tasa de descarte de su historia real (tarea 7.4 del change 72) se puede bajar el puntaje hacia (b) si los avisos resultan pocos.

### 2. [B para la tarea 5.2 del change 85] Criterio de salida revisado (D483)

- (a) Mantener precisión ≥ 0.60 y recall ≥ 0.70, bloqueante. Con (a) de la pregunta 1 hay mucho margen, pero la fila solo fallaría ante una regresión grave: los marcados sin etiqueta podrían pasar de 8 a 70 sin que falle.
- (b) **Precisión ≥ 0.80 y recall ≥ 0.85 con el Large Seed a escala completa, bloqueante, y el informe con los marcados sin etiqueta por criterio.** Con (a) de la pregunta 1 deja margen de 0.13 y 0.09; falla si los marcados sin etiqueta superan unos 30 o si se pierden más de 11 anomalías.
- (c) Dejar la fila informativa de forma permanente y decidir solo con la tasa de descarte de los datos reales.

**Recomendación: (b).** Detecta una regresión real sin volver a dejar el nightly en rojo, y el desglose por criterio dice cuál se degradó. El criterio con datos reales (tasa de descarte, tarea 7.4 del change 72) sigue aparte y es el que confirma la calibración.

### 3. Anomalías moderadas en el Large Seed

El Large Seed solo inyecta anomalías de 5 a 20 veces el monto máximo de la categoría, así que ninguna variante se mide con gastos de 3 a 8 veces la mediana, que son los que (a) de la pregunta 1 deja de marcar.

- (a) **Dejarlo así y confirmar el punto de corte con la tasa de descarte de su historia real.**
- (b) Abrir un change para que el seed inyecte también anomalías moderadas etiquetadas, sin cambiar la versión del dataset de los demás golden.

**Recomendación: (a).** Cambiar el seed afecta a todos los benchmarks que lo usan, y el dato que importa es cuántos avisos reales descarta el owner.

## Respuestas

Contestadas el 2026-11-25 y registradas en [docs/81](81-anomaly-calibration-decisions.md) con los ids D513 (pregunta 1, opción a), D514 (pregunta 2, opción b) y D515 (pregunta 3, sin respuesta: sigue la recomendación a).
