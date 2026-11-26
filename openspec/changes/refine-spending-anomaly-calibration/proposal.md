# Propuesta: refine-spending-anomaly-calibration

## Why

El change 72 (`add-spending-anomaly-detection`, fusionado en #288) detecta gastos atípicos con mediana y MAD con los parámetros de D473 (puntaje robusto ≥ 3.5, al menos 3 veces la mediana, historia ≥ 8, percentil 95 para la contraparte nueva). Contra las anomalías etiquetadas del Large Seed esos parámetros marcan casi todo lo que no es habitual: a escala completa, 8 553 gastos marcados de 92 146 evaluados, recall 0.9919 y precisión 0.0143, muy por debajo del criterio de D483 (precisión ≥ 0.60 y recall ≥ 0.70). Los montos del seed son log-normales y su cola natural supera con facilidad 3 veces la mediana y 3.5 MAD; los gastos reales también tienen cola larga (D488), así que el problema no es solo del seed.

El owner decidió el 2026-11-25 (D488) pasar la fila del nightly a informativa ya, recalibrar los umbrales con una rejilla a escala completa del Large Seed y revisar el criterio de D483. La rejilla ([design](design.md)) muestra que cambiar solo los parámetros no alcanza: el criterio por contraparte compara gastos de categorías distintas de la misma contraparte y genera el 80 % de los falsos positivos, y los parámetros que lo silencian dejan el recall en 0.33 con el volumen de una persona (escala 0.1).

## What Changes

- **Contraparte dentro de su categoría** (`forecast/anomaly-detection`, MODIFIED): el monto de un gasto con contraparte se compara con los gastos de esa contraparte **en la misma categoría principal** (la de la porción de mayor monto) de los 365 días anteriores, no con todos sus gastos. Una contraparte nueva sigue siendo la que no tiene ningún gasto en esos 365 días.
- **Parámetros por omisión recalibrados** (MODIFIED): puntaje robusto ≥ **15** (era 3.5), razón ≥ 3 la mediana (sin cambio), historia ≥ 8 (sin cambio) y percentil **99.5** para la contraparte nueva (era 95). Siguen configurables por variable de entorno.
- **Criterio de salida revisado** (MODIFIED, recomendación de [docs/80](../../../docs/80-anomaly-calibration-questions.md) pendiente del owner): la fila del nightly con el Large Seed a escala completa vuelve a ser bloqueante con precisión ≥ 0.80 y recall ≥ 0.85, y el informe agrega los falsos positivos por criterio.
- **Rejilla reproducible:** el runner `pnpm forecast:anomalies:backtest` acepta umbrales por argumento para repetir la rejilla sin tocar la configuración.
- **Fuera de alcance:**
  - Transformación logarítmica de los montos y piso del MAD: se evaluaron en la rejilla y se descartan (design, decisión 3).
  - Isolation Forest u otro modelo en el servicio Python (D473, mejora posterior).
  - Cambiar el seed para que inyecte anomalías más sutiles (pregunta 3 de docs/80).
  - El criterio con los datos reales del owner (tarea 7.4 del change 72).

## Capabilities

### New Capabilities
Ninguna.

### Modified Capabilities
- `forecast/anomaly-detection`: 5 MODIFIED. Gastos atípicos para su categoría (umbral del puntaje robusto), gastos atípicos para su contraparte (dentro de la categoría principal), contraparte nueva con monto alto (percentil 99.5), motivo explicable (referencia del percentil configurado) y evaluación contra las anomalías etiquetadas del Large Seed (umbrales revisados y falsos positivos por criterio).

## Impact

**Specs impactadas:** `forecast/anomaly-detection` (5 MODIFIED). La capability la crea el change 72, que todavía no está archivado: este change se archiva **después** de `add-spending-anomaly-detection`.

**Componentes/contextos impactados:**
- FORECAST: `SpendingAnomalyDetector` (contraparte por categoría principal), `ExpenseHistoryIndex` (índice por contraparte y categoría), `DEFAULT_ANOMALY_THRESHOLDS`, `MIN_PRECISION` y `MIN_RECALL` del backtesting y el informe por criterio.
- `apps/api`: runner `forecast-anomalies-backtest` con umbrales opcionales; `test/perf/anomalies.perf.ts` vuelve a bloqueante.
- `packages/platform` (configuración): valores por omisión de `FORECASTING_ANOMALY_ROBUST_Z` (15) y `FORECASTING_ANOMALY_NEW_COUNTERPARTY_PERCENTILE` (99.5); `docs/config-reference.md`.

**APIs impactadas:** ninguna. `SpendingAnomalyReason` ya lleva `kind`, `reference`, `ratio`, `robustScore` y `sampleSize`; con la contraparte por categoría, `categoryId` del motivo `COUNTERPARTY_OUTLIER` pasa a informar la categoría principal (el campo ya existe y es nullable).

**Tablas impactadas:** ninguna. **Eventos impactados:** ninguno. **Migraciones requeridas:** ninguna. Los gastos atípicos ya marcados no se recalculan; los nuevos usan los parámetros nuevos.

**Test cases:**
- AÑADIDOS: TC-FORECAST-ANOMALY-027..032 (6).
- MODIFICADOS: TC-FORECAST-ANOMALY-005 (MAD de la contraparte 8.00 BOB, historia en la misma categoría), -006 y -007 (percentil 99.5) y -025 (umbrales 0.80 y 0.85).
- DEPRECADOS: ninguno.

**Impacto de regresión:** TC-FORECAST-ANOMALY-001..004 y -008..024 sin cambios; -026 (pasada ≤ 10 s) debe seguir en verde con el índice por par contraparte-categoría.

**Riesgos introducidos:** anomalías moderadas (3 a 8 veces la mediana en una categoría dispersa) dejan de marcarse. El Large Seed solo inyecta anomalías de 5 a 20 veces el máximo de la categoría, así que no mide ese tramo (pregunta 3 de docs/80); la tasa de descarte con los datos del owner (tarea 7.4 del change 72) es la que confirma el punto de corte.

**Invariantes afectadas:** ninguna. La detección sigue sin bloquear ni modificar transacciones.
