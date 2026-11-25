# Diseño

## Contexto

Change 85 (docs/03 §7, Phase 9), seguimiento del change 72 `add-spending-anomaly-detection` (#288, sin archivar). Decisiones que aplican: D473 (mediana y MAD en TypeScript dentro de `forecasting.schedule`), D483 (criterio de salida con el Large Seed: precisión ≥ 0.60 y recall ≥ 0.70) y D488 ([docs/77](../../../docs/77-phase-9-and-card-interest-decisions.md): fila del nightly informativa ya, recalibración con una rejilla a escala completa y revisión de D483). Las preguntas nuevas están en [docs/80](../../../docs/80-anomaly-calibration-questions.md); la spec está redactada con sus recomendaciones, como los changes 70 a 76.

Desde D488, `apps/api/test/perf/anomalies.perf.ts` mide y publica la precisión y el recall (consola y `reports/perf/anomalies.json`) sin fallar el job.

## Cómo se hizo la rejilla

- **Datos:** Large Seed a escala completa (`PF_PERF_SCALE=1`, 60 meses, workspace principal) sembrado con Testcontainers como en el nightly; 92 146 gastos evaluados y 123 gastos con etiqueta `OUTLIER` o `NEW_COUNTERPARTY_FRAUD` (119 y 3 marcados por la línea de base, más uno sin evaluar). Para medir la sensibilidad al volumen se repitió a escala 0.1 (11 134 gastos, 12 etiquetados), que se parece más al volumen de una persona (unos 150 gastos por mes). La siembra a escala completa tardó 42 minutos en la máquina de desarrollo.
- **Método:** se volcaron los gastos valorados con la misma carga de la detección (`loadExpenses`: porciones, contraparte, montos en la moneda de reporte con la tasa de su fecha) y se evaluó cada combinación con una réplica en punto flotante de `SpendingAnomalyDetector` sobre las mismas ventanas de 365 días. La réplica reproduce exactamente el informe de `BacktestSpendingAnomalies` con los parámetros de D473 (escala completa: 8 553 marcados, 122 positivos, 8 427 sin etiqueta y 4 con otra etiqueta; escala 0.1: 318, 12, 306 y 0).
- **Métricas:** precisión = positivos marcados / (positivos marcados + marcados sin etiqueta); los marcados con otras etiquetas (`DUPLICATE_CHARGE`, `SUBSCRIPTION_PRICE_HIKE`, `P2P_RATE_JUMP`) no cuentan (D475). Recall = positivos marcados / 123 (o 12).
- **Rejilla:** puntaje robusto {3.5, 5, 8, 10, 15, 20, 25, 30} × razón {3, 4, 5, 6, 8} × historia mínima {8, 12, 20} × percentil de contraparte nueva {95, 98, 99, 99.5}, con tres variantes del puntaje (MAD clásico, montos en logaritmo con puntaje {3.5…10} y piso del MAD {0.1, 0.25, 0.5, 1.0} × mediana), más la variante de contraparte dentro de su categoría principal. 2 100 combinaciones por escala.

## Resultados

Filas representativas (P = precisión, R = recall, M = gastos marcados). Razón 3 e historia mínima 8 salvo que se indique.

| # | Variante | Escala completa P | R | M | Escala 0.1 P | R | M |
|---|---|---|---|---|---|---|---|
| 1 | D473: z ≥ 3.5, percentil 95 (hoy) | 0.0143 | 0.9919 | 8 553 | 0.0377 | 1.0000 | 318 |
| 2 | Solo parámetros: z ≥ 15, percentil 99.5 | 0.2734 | 0.9512 | 429 | 0.8000 | 1.0000 | 15 |
| 3 | Solo parámetros: z ≥ 20, percentil 99.5 | 0.5134 | 0.9350 | 224 | 0.7857 | 0.9167 | 14 |
| 4 | Solo parámetros: z ≥ 30, historia ≥ 20, percentil 99.5 (mejor fila de la rejilla a escala completa) | 0.8609 | 0.8049 | 115 | 1.0000 | 0.3333 | 4 |
| 5 | Montos en logaritmo, z ≥ 3.5, percentil 99.5 | 0.4394 | 0.9431 | 265 | 0.4231 | 0.9167 | 26 |
| 6 | Piso del MAD = mediana, z ≥ 5, percentil 99.5 | 0.0598 | 0.9837 | 2 026 | 0.5714 | 1.0000 | 21 |
| 7 | Contraparte por categoría, logaritmo z ≥ 3.5, percentil 99.5 | 0.9127 | 0.9350 | 126 | 0.4400 | 0.9167 | 25 |
| 8 | Contraparte por categoría, z ≥ 15, percentil 95 | 0.7532 | 0.9431 | 154 | 0.3243 | 1.0000 | 37 |
| 9 | Contraparte por categoría, z ≥ 10, percentil 99.5 (más sensible) | 0.8561 | 0.9675 | 139 | 0.5217 | 1.0000 | 23 |
| **10** | **Contraparte por categoría, z ≥ 15, percentil 99.5 (propuesta)** | **0.9355** | **0.9431** | **124** | **0.8000** | **1.0000** | **15** |

Falsos positivos (marcados sin etiqueta) por criterio a escala completa; un gasto puede tener más de un motivo:

| Criterio | D473 (fila 1) | Propuesta (fila 10) |
|---|---|---|
| Categoría | 2 526 | 1 |
| Contraparte | 6 807 | 0 |
| Contraparte nueva | 37 | 7 |

Lo que muestra la rejilla:
- **La contraparte global es la fuente principal de ruido.** En el seed las contrapartes de compras no dependen de la categoría (un mismo comercio vende pasajes y ropa), así que su historia mezcla montos de órdenes de magnitud distintos. En los datos reales pasa lo mismo con un supermercado o una tienda en línea. Ningún umbral la arregla sin perder recall: la fila 4 lo logra a escala completa, pero con el volumen de una persona deja el recall en 0.33.
- **El criterio por categoría separa bien** las anomalías inyectadas con z ≥ 15: 115 de 123 positivos con 1 falso positivo a escala completa y 12 de 12 sin falsos positivos a escala 0.1. Con z ≥ 10 marca 4 positivos más, pero los falsos positivos suben a 12 y 8; con z ≥ 20 se pierden 2 positivos.
- **La razón (3 a 8) no cambia nada con z ≥ 15**: el puntaje ya exige montos varias veces la mediana. Se deja en 3 como piso explicable.
- **Historia mínima 12 o 20** baja el recall a escala 0.1 sin mejorar la precisión de la propuesta.
- **Percentil de contraparte nueva:** con 95 marca 37 gastos sin etiqueta a escala completa y 25 a escala 0.1; con 99.5, 7 y 3. Los 3 `NEW_COUNTERPARTY_FRAUD` también los marca el criterio por categoría.
- **Transformación logarítmica:** a escala completa iguala a la propuesta en la categoría, pero con historias cortas el MAD logarítmico de montos discretizados es chico y dispara falsos positivos (precisión 0.44 a escala 0.1).
- **Piso del MAD:** no corrige la contraparte global y, por categoría, hace falta un piso tan alto que equivale a subir la razón.

## Objetivos / No objetivos

**Objetivos**
- Precisión y recall altos con el Large Seed a las dos escalas, con un cambio chico y explicable del método.
- Un criterio de salida que detecte una regresión real, no solo una caída catastrófica.
- Poder repetir la rejilla con el runner existente.

**No objetivos**
- Medir anomalías moderadas (de 3 a 8 veces la mediana): el seed no las inyecta (pregunta 3 de docs/80).
- Cambiar la API, las tablas, los eventos o la UI.
- Recalcular los gastos atípicos ya marcados.

## Decisiones

1. **Contraparte dentro de su categoría principal.** La categoría principal de un gasto es la categoría de su porción de mayor monto en la moneda de reporte (con empate, la de menor índice de porción); las porciones en «sin categoría» no cuentan, y un gasto sin ninguna porción categorizada no se evalúa por contraparte. `ExpenseHistoryIndex` agrega un índice por el par `(contraparte, categoría principal)` y `ExpenseHistory` una lectura `counterpartyInCategory(counterpartyId, categoryId)`. El criterio de contraparte compara el monto total con esa historia, con el mismo puntaje, razón e historia mínima. La contraparte nueva se sigue definiendo con la historia de la contraparte en todas sus categorías. El motivo `COUNTERPARTY_OUTLIER` informa la categoría principal en `categoryId` (hoy `null`) y la UI lo muestra como «… la mediana de Pizzería Demo en Restaurantes». *Alternativas descartadas:* subir solo los umbrales (filas 2 a 4: o mucho ruido a escala completa o recall 0.33 con el volumen de una persona); apagar el criterio de contraparte (pierde el caso real de un comercio habitual que cobra mucho más que de costumbre en la misma categoría).

2. **Parámetros por omisión.**

   | Variable | Hoy (D473) | Propuesta |
   |---|---|---|
   | `FORECASTING_ANOMALY_ROBUST_Z` | 3.5 | 15 |
   | `FORECASTING_ANOMALY_MIN_RATIO` | 3.0 | 3.0 |
   | `FORECASTING_ANOMALY_MIN_SAMPLE` | 8 | 8 |
   | `FORECASTING_ANOMALY_NEW_COUNTERPARTY_PERCENTILE` | 95 | 99.5 |

   El valor 15 es alto frente al 3.5 de Iglewicz y Hoaglin porque el MAD de los montos de una categoría es chico frente a su cola: en el seed, z ≥ 15 equivale a montos de entre 9.5 y 13.9 veces la mediana de la categoría (percentiles 10 y 90 de las ventanas evaluadas; 8.2 a 15.1 a escala 0.1). Es decir, la propuesta solo marca gastos muy fuera de lo habitual. z ≥ 10 (fila 9) baja ese corte a unas 7 a 10 veces la mediana y sube el recall, pero con el volumen de una persona la precisión cae a 0.52 (pregunta 1 de docs/80). Los cuatro siguen configurables; el owner puede bajarlos si su tasa de descarte lo permite (tarea 7.4 del change 72).

3. **Variantes descartadas.** Montos en logaritmo (fila 5 y 7: inestable con historias cortas) y piso del MAD (fila 6: no corrige la contraparte). Quedan documentadas aquí para no repetirlas.

4. **Criterio de salida revisado (recomendación de la pregunta 2 de docs/80).** Fila del nightly **bloqueante** con el Large Seed a escala completa: precisión ≥ 0.80 y recall ≥ 0.85. Con la propuesta hay margen de 0.13 y 0.09. La variante más sensible (fila 9) también pasa. Con 0.60 y 0.70 (D483), una regresión que lleve los marcados sin etiqueta de la propuesta de 8 a 70 seguiría pasando; con 0.80 falla a partir de unos 30. Hasta que este change se implemente, la fila sigue informativa (D488). El informe agrega los marcados sin etiqueta por criterio, para ver qué criterio se degradó.

5. **Rejilla reproducible.** `pnpm forecast:anomalies:backtest -- --workspace <id> --labels <ruta.jsonl> [--robust-z N] [--min-ratio N] [--min-sample N] [--new-counterparty-percentile N]` reemplaza los umbrales solo para esa corrida, sin tocar la configuración ni persistir nada. El informe dice qué umbrales usó. Con eso la rejilla se puede repetir con el runner oficial cuando cambie el seed o la historia del owner.

6. **Sin recálculo.** Los gastos atípicos ya marcados no cambian; la pasada diaria solo evalúa versiones sin evaluar (decisión 6 del change 72). En N1 no hay marcados todavía con datos reales.

## Contratos

**API:** sin cambios. `SpendingAnomalyReason.categoryId` ya existe y es nullable; en `COUNTERPARTY_OUTLIER` pasa a llevar la categoría principal (cambio de valor, no de esquema; `oasdiff` limpio). Se actualiza su descripción en `contracts/openapi/finance-api.v1.yaml`.

**Contratos internos (TypeScript):** `ExpenseHistory.counterpartyInCategory(counterpartyId, categoryId)` en el dominio de FORECAST; `AnomalyBacktestReport.unlabeledByCriterion` y `thresholds` en el informe.

**Eventos, tablas y migraciones:** ninguno.

**Configuración (worker; `docs/config-reference.md` y `pnpm config:docs:check`):** valores por omisión nuevos de `FORECASTING_ANOMALY_ROBUST_Z` (15) y `FORECASTING_ANOMALY_NEW_COUNTERPARTY_PERCENTILE` (99.5).

## Riesgos / Trade-offs

- [Anomalías moderadas (menos de unas 9 veces la mediana) que dejan de marcarse] → el seed no las mide; la tasa de descarte del owner y la pregunta 3 de docs/80 (seed con anomalías de 3 a 8 veces) lo cubren. Los parámetros siguen configurables.
- [Ajuste al seed] → la propuesta se eligió por su estabilidad a las dos escalas y no por la mejor fila de una sola; aun así es un dato sintético (RISK-015).
- [Contraparte con poca historia por categoría] → con menos de 8 gastos en el par no se evalúa por contraparte; el criterio por categoría sigue activo.
- [Costo del índice por par] → un mapa más sobre los mismos gastos ya cargados; TC-FORECAST-ANOMALY-026 (≤ 10 s) lo vigila.

## Plan de migración

Sin migración. Deploy: el worker toma los valores por omisión nuevos salvo que el entorno los fije. Rollback: fijar `FORECASTING_ANOMALY_ROBUST_Z=3.5` y `FORECASTING_ANOMALY_NEW_COUNTERPARTY_PERCENTILE=95` devuelve los umbrales de D473 (la contraparte por categoría queda).

## Cambios a docs compartidos (al implementar)

- **docs/15 §12:** as-built de la calibración y de la contraparte por categoría.
- **docs/config-reference.md:** valores por omisión nuevos.
- **docs/23:** la fila de anomalías vuelve a bloqueante con los umbrales que fije el owner.
- **docs/17 y la matriz:** TC nuevos y modificados. **docs/38:** estado del change.

## Preguntas abiertas

En [docs/80](../../../docs/80-anomaly-calibration-questions.md):
1. **[B para los grupos 2 y 3]** Método y parámetros por omisión (recomendación: contraparte dentro de su categoría principal, z ≥ 15, percentil 99.5).
2. **[B para la tarea 5.2]** Criterio de salida revisado de D483 (recomendación: precisión ≥ 0.80 y recall ≥ 0.85 a escala completa, bloqueante).
3. Anomalías moderadas en el Large Seed (no bloquea).
