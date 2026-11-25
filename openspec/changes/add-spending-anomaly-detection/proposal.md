# Propuesta: add-spending-anomaly-detection

## Why

FR-FORECAST-010 (movida a Phase 9 por D442) y US-246 piden ver los gastos atípicos para su categoría o su contraparte, con el motivo. El owner aprobó el alcance de Phase 9 (D472) y eligió el método (D473): estadística robusta (mediana y MAD) en TypeScript dentro de FORECAST, en un trabajo diario dentro de `forecasting.schedule`, sin depender del servicio Python, que en N1 está deshabilitado. Con D474 la lista y la marca en la transacción se ven siempre, el aviso queda apagado por omisión y nada bloquea ni modifica una transacción. Con D483 la detección se evalúa contra las anomalías etiquetadas del Large Seed. D475 deja fuera los cargos duplicados y los cambios de precio, que ya cubren otras funciones.

## What Changes

- **Detección por categoría y por contraparte:** cada porción de gasto se compara con los 365 días anteriores de su categoría, y cada gasto con los de su contraparte, en la moneda de reporte. Se marca cuando el puntaje robusto es ≥ 3.5 y el monto es ≥ 3 veces la mediana, con al menos 8 gastos de historia.
- **Contraparte nueva con monto alto:** un gasto con una contraparte sin gastos en los 365 días anteriores y monto ≥ percentil 95 de los gastos del workspace.
- **Alcance:** solo gastos posteados, sin los administrados por otro módulo (préstamos, cargos de tarjeta de D465, metas) ni los vinculados a compromisos (los cambios de precio de suscripciones ya se detectan aparte, D475).
- **Trabajo diario:** dentro de `forecasting.schedule`, sobre los gastos de los últimos 7 días no evaluados en su versión vigente. Funciona con los pronósticos deshabilitados (`FORECASTING_ANOMALIES_ENABLED`, por omisión `true`), sin consumidores ni conexiones nuevas (D249).
- **Lista «Gastos atípicos»** con motivos explicables por plantilla, la marca en el listado y el detalle de la transacción, y descarte y restauración (OWNER y EDITOR, auditados).
- **Aviso** de tipo gasto atípico: una notificación por pasada y destinatario (OWNER y EDITOR), desactivada por omisión en los dos canales, con emails sin montos salvo opt-in.
- **Evaluación en el nightly** contra las etiquetas `OUTLIER` y `NEW_COUNTERPARTY_FRAUD` del Large Seed: precisión ≥ 0.60 y recall ≥ 0.70 (D483).
- **Fuera de alcance:** Isolation Forest en el servicio Python (mejora posterior, D473); cargos duplicados y cambios de precio (D475); automatizaciones (D479); modificar o bloquear transacciones.

## Capabilities

### New Capabilities
- `forecast/anomaly-detection`: 13 ADDED. Detección por categoría, por contraparte y por contraparte nueva, alcance, motivo, trabajo diario, no intrusión, lista y marca, descarte, cambios de la transacción, permisos, retención y portabilidad, evaluación con el Large Seed, y rendimiento y métricas.

### Modified Capabilities
- `notifications/alerts`: 2 ADDED. Aviso de gastos atípicos desactivado por omisión, y emails sin montos salvo opt-in, en los tres idiomas.

## Impact

**Specs impactadas:** `forecast/anomaly-detection` (nueva, 13 ADDED) y `notifications/alerts` (2 ADDED). Lee sin modificar: `transactions/transaction-recording`, `commitments/recurrence-engine`, `fx/market-rates`, `classification/categories` y `classification/counterparties`.

**Componentes/contextos impactados:** FORECAST: dominio `RobustStats` (mediana, MAD, percentil por rango más cercano, con Decimal) y DS `SpendingAnomalyDetector`; aplicación `DetectSpendingAnomalies` (paso del trabajo diario), consultas, descarte y restauración; infraestructura PG y la query de backtesting. TRANSACTIONS: query nueva `ExpenseLineQuery` en sus contratos (aditiva, sin efectos). NOTIFICATIONS: hecho nuevo `SpendingAnomaliesDetectedFact` en el puerto en proceso y tipo `SPENDING_ANOMALY`, desactivado por omisión. Worker: `forecasting.schedule` se registra cuando están habilitados los pronósticos o la detección. `apps/web`: vista `/gastos-atipicos`, marca en el listado y el detalle de transacciones y preferencia del tipo, con i18n es/en/pt.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` (aditivo): `GET /workspaces/{workspaceId}/spending-anomalies`, `POST …/spending-anomalies/{anomalyId}/dismiss`, `POST …/spending-anomalies/{anomalyId}/restore`; esquemas `SpendingAnomaly`, `SpendingAnomalyReason`, `SpendingAnomalyPage` y `SpendingAnomalyDismissInput`; `NotificationType` suma `SPENDING_ANOMALY` (`x-extensible-enum`). Sin códigos de error nuevos.

**Tablas impactadas:** `forecasting.spending_anomaly` (nueva, RLS forzada, registrada en `platform.workspace_scoped_table`).

**Eventos impactados:** ninguno. La notificación usa el puerto en proceso, en la misma unidad de trabajo, como `reporting.cash-flow-watch`.

**Migraciones requeridas:** una migración expand que crea `forecasting.spending_anomaly` con sus políticas.

**Test cases:** AÑADIDOS: TC-FORECAST-ANOMALY-001..026 (26) y TC-NOTIFICATIONS-ANOMALY-001..005 (5). MODIFICADOS: ninguno. DEPRECADOS: ninguno.

**Impacto de regresión:** `forecasting.schedule` se registra también con los pronósticos deshabilitados (TC-FORECAST-ANOMALY-011 y el test de arranque del worker: 28 + 4 = 32 de 34 sin cambios); las corridas de pronóstico no cambian (TC-FORECAST-SERVICE-*); los listados de transacciones no cambian de contrato.

**Riesgos introducidos:** RISK-015 (confianza indebida: textos que no hablan de error ni fraude, descarte en un clic), RISK-014 (pocos datos: mínimo de 8 gastos de historia), ruido de avisos (apagado por omisión y uno por pasada), RISK-017 (tasas: sin tasa no se evalúa).

**Invariantes afectadas:** INV-001 e INV-020 (cálculos con Decimal y HALF_EVEN al mostrar). Ninguna escritura en el ledger ni en las transacciones.
