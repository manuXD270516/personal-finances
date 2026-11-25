# Tareas

> Change 72 (Phase 9, docs/03 §7, D472). Requiere `add-ml-forecasting-service` (64) y `add-expense-forecasts` (65) fusionados; se archiva después de ellos. Decisiones D473, D474, D475 y D483 ([docs/77](../../../docs/77-phase-9-and-card-interest-decisions.md)); ninguna pregunta abierta lo bloquea. Gates: los de CLAUDE.md, con `pnpm test:integration` dos veces seguidas en verde y `pnpm test:e2e` con `PF_E2E_PROJECT`.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar los deltas de `forecast/anomaly-detection` y `notifications/alerts` contra D473, D474, D475 y D483; `openspec validate add-spending-anomaly-detection --strict`
- [ ] 1.2 Revisar TC-FORECAST-ANOMALY-001..026 y TC-NOTIFICATIONS-ANOMALY-001..005 contra los scenarios. Cifras: mediana 80.00 y MAD 7.50 de la historia de 12 gastos; 304.00 / 80.00 = 3.8; 200.00 / 80.00 = 2.5; 132.00 / 40.00 = 3.3; 304.00 / 95.00 = 3.2; 50.00 × 6.96 = 348.00 y 348.00 / 80.00 = 4.35, que con HALF_EVEN da 4.4; precisión 100 / 130 = 0.7692 y recall 100 / 125 = 0.8000. Pasar a `ready` y `requirement_status: confirmed`

## 2. DOMAIN (TDD)

- [ ] 2.1 `RobustStats` puro test-first (mediana, MAD, puntaje robusto, percentil por rango más cercano, con Decimal), con PBT y timeout explícito: la mediana y el MAD no cambian al permutar la muestra, y la mediana queda entre el mínimo y el máximo: TC-FORECAST-ANOMALY-001..004
- [ ] 2.2 DS `SpendingAnomalyDetector`: porción por categoría, gasto por contraparte y contraparte nueva; un resultado por transacción y versión con sus motivos; razón con 1 decimal HALF_EVEN: TC-FORECAST-ANOMALY-001..007
- [ ] 2.3 Agregado `SpendingAnomaly` con estados `OPEN`, `DISMISSED` y `SUPERSEDED`; descarte y restauración inocuos al repetirse: TC-FORECAST-ANOMALY-018..020
- [ ] 2.4 Plantilla del motivo (es/en/pt), sin las palabras error ni fraude: TC-FORECAST-ANOMALY-014

## 3. APPLICATION

- [ ] 3.1 TRANSACTIONS: `ExpenseLineQuery.listExpenseLines` en `@pf/transactions/contracts` (keyset `(fecha, id)`, solo `EXPENSE` posteados no anulados, con `managedBy` y `debtRole`), implementada en PG: TC-FORECAST-ANOMALY-009
- [ ] 3.2 FORECAST: `DetectSpendingAnomalies` (historia de 365 + 7 días por workspace, exclusión de administrados y de transacciones de ocurrencias resueltas, valoración por fecha, sin tasa ⇒ no se evalúa, registro de versiones evaluadas, reemplazo de versiones): TC-FORECAST-ANOMALY-008..012 y -020
- [ ] 3.3 `ScheduleForecastRuns` y el trabajo `forecasting.schedule`: dos pasos independientes (pronósticos si `FORECASTING_ENABLED`, detección si `FORECASTING_ANOMALIES_ENABLED`), registro del trabajo si cualquiera está habilitado y el ejecutor solo con los pronósticos; test con las cuatro combinaciones: TC-FORECAST-ANOMALY-011
- [ ] 3.4 Consultas (lista paginada, por `transactionId`, filtrado de anuladas y `transactionChanged`), descarte y restauración con auditoría `SpendingAnomaly`: TC-FORECAST-ANOMALY-016, -018, -019 y -021
- [ ] 3.5 NOTIFICATIONS: `SpendingAnomaliesDetectedFact` en `NotificationIntakePort`, tipo `SPENDING_ANOMALY` desactivado por omisión en el catálogo (los tipos existentes siguen activos), una notificación por pasada y destinatario (OWNER y EDITOR), plantillas es/en/pt y email sin detalles salvo opt-in: TC-NOTIFICATIONS-ANOMALY-001..005
- [ ] 3.6 Retención (25 meses por fecha de la transacción; registros de versiones evaluadas a los 30 días) en el paso de mantenimiento, y exclusión del export: TC-FORECAST-ANOMALY-024

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand de `forecasting.spending_anomaly` y `forecasting.spending_anomaly_scan` (RLS forzada, D298, registro en `platform.workspace_scoped_table`, permisos del rol de mantenimiento); timestamp posterior a la última de `main`: TC-FORECAST-ANOMALY-023
- [ ] 4.2 Tests de integración con PostgreSQL real (Testcontainers): exclusiones, no modificación de transacciones, aislamiento e idempotencia de la notificación: TC-FORECAST-ANOMALY-009, -015, -023 y TC-NOTIFICATIONS-ANOMALY-003
- [ ] 4.3 Arranque del worker con la plantilla del host y la detección habilitada: mismos consumidores y conexiones (28 + 4 = 32 de 34): TC-FORECAST-ANOMALY-013
- [ ] 4.4 Variables `FORECASTING_ANOMALIES_ENABLED`, `FORECASTING_ANOMALY_LOOKBACK_DAYS`, `FORECASTING_ANOMALY_ROBUST_Z`, `FORECASTING_ANOMALY_MIN_RATIO`, `FORECASTING_ANOMALY_MIN_SAMPLE` y `FORECASTING_ANOMALY_NEW_COUNTERPARTY_PERCENTILE` en `variables.ts`, la plantilla del host y `docs/config-reference.md` (`pnpm config:docs:check`)
- [ ] 4.5 Métricas `forecast_anomaly_*`, sin montos ni ids: TC-FORECAST-ANOMALY-026
- [ ] 4.6 `pnpm arch:check`: FORECAST → TRANSACTIONS y FORECAST → NOTIFICATIONS solo por contratos, sin ciclos

## 5. API

- [ ] 5.1 Endpoints `listSpendingAnomalies`, `dismissSpendingAnomaly` y `restoreSpendingAnomaly`, esquemas nuevos, `NotificationType.SPENDING_ANOMALY` y `NotificationLink.kind.SPENDING_ANOMALIES` en el contrato (aditivo; `pnpm contract:breaking` limpio; Spectral y Redocly sin errores): TC-FORECAST-ANOMALY-016, -018, -019, -021 y -022
- [ ] 5.2 Runner `pnpm forecast:anomalies:backtest -- --workspace <id> --labels <ruta.jsonl>` y fila bloqueante del nightly con el Large Seed: precisión ≥ 0.60 y recall ≥ 0.70 sobre `OUTLIER` y `NEW_COUNTERPARTY_FRAUD`, informe sin montos ni descripciones: TC-FORECAST-ANOMALY-025
- [ ] 5.3 Benchmark de la pasada diaria con el workspace principal del Large Seed (≤ 10 s, nightly, timeout explícito): TC-FORECAST-ANOMALY-026

## 6. UI

- [ ] 6.1 Vista `/gastos-atipicos` (menú junto a Pronósticos): filtros de estado y rango, tabla accesible, motivos por plantilla, «No es atípico» y «Restaurar» para OWNER y EDITOR, aviso cuando la función está deshabilitada; i18n es/en/pt: TC-FORECAST-ANOMALY-016, -018 y -019
- [ ] 6.2 Marca de atípico en el listado y el detalle de transacciones (consulta por `transactionId` de las filas visibles): TC-FORECAST-ANOMALY-017
- [ ] 6.3 Preferencias de notificaciones con el tipo gasto atípico apagado por omisión: TC-NOTIFICATIONS-ANOMALY-001

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar todos los TC del change con el TC-id en el nombre del test y actualizar el front matter
- [ ] 7.2 E2E con el dataset Demo y un gasto atípico sembrado: lista, marca en la transacción, descarte y restauración, sin violaciones serias de axe: TC-FORECAST-ANOMALY-017
- [ ] 7.3 Regresión: TC-FORECAST-SERVICE-* (corridas programadas) y TC-PLATFORM-THROUGHPUT-009 en verde sin cambios
- [ ] 7.4 Criterio de salida con datos reales (espera al owner, D472): registrar la tasa de descarte del owner sobre sus gastos atípicos de 3 periodos, sin montos ni descripciones

## 8. DOCUMENTATION

- [ ] 8.1 Aplicar design.md § «Cambios a docs compartidos»
- [ ] 8.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
