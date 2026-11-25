# Tareas

> Change 85 (Phase 9, docs/03 §7, D488). Seguimiento de `add-spending-anomaly-detection` (72, fusionado en #288 y sin archivar): sus deltas son MODIFIED sobre `forecast/anomaly-detection`, que crea el 72, así que se archiva **después** de él. Las preguntas 1 y 2 de [docs/80](../../../docs/80-anomaly-calibration-questions.md) bloquean los grupos 2 y 3 y la tarea 5.2; la spec está redactada con sus recomendaciones. Sin consumidores, conexiones, migraciones ni cambios de API (D249). Gates: los de CLAUDE.md; `pnpm test:integration` dos veces seguidas en verde; `pnpm test:e2e` con `PF_E2E_PROJECT` por el texto del motivo.

## 1. SPEC y TEST CASES

- [ ] 1.1 Registrar en el siguiente `…-decisions.md` las respuestas del owner a las preguntas 1 a 3 de docs/80 y ajustar los deltas si alguna cambia la recomendación; `openspec validate refine-spending-anomaly-calibration --strict`
- [ ] 1.2 Revisar TC-FORECAST-ANOMALY-027..032 y los modificados -005, -006, -007 y -025 contra los scenarios; pasarlos a `ready` y `requirement_status: confirmed`

## 2. DOMAIN (TDD; bloqueado por la pregunta 1 de docs/80)

- [ ] 2.1 FORECAST, test-first: `ExpenseHistoryIndex` con el índice por par contraparte y categoría principal (porción de mayor monto sin contar «sin categoría»; con empate, la primera) y `ExpenseHistory.counterpartyInCategory`: TC-FORECAST-ANOMALY-028 y -029
- [ ] 2.2 FORECAST, test-first: `SpendingAnomalyDetector` compara la contraparte dentro de su categoría principal y lleva esa categoría en `categoryId` del motivo `COUNTERPARTY_OUTLIER`; la contraparte nueva sigue usando la historia de la contraparte en todas sus categorías: TC-FORECAST-ANOMALY-005, -028 y -029
- [ ] 2.3 `DEFAULT_ANOMALY_THRESHOLDS`: puntaje robusto 15 y percentil 99.5 (razón 3 e historia 8 sin cambio); actualizar los tests de dominio que usan los valores por omisión y el PBT: TC-FORECAST-ANOMALY-001, -002, -006, -007 y -027

## 3. APPLICATION

- [ ] 3.1 `buildBacktestReport`: umbrales de salida 0.80 y 0.85 (según la respuesta a la pregunta 2), umbrales usados y marcados sin etiqueta por criterio en el informe, sin montos ni descripciones: TC-FORECAST-ANOMALY-025 y -031
- [ ] 3.2 `BacktestSpendingAnomalies.run` acepta umbrales opcionales para una corrida sin tocar la configuración: TC-FORECAST-ANOMALY-032

## 4. INFRASTRUCTURE y configuración

- [ ] 4.1 `packages/platform/src/config/variables.ts`: valores por omisión `FORECASTING_ANOMALY_ROBUST_Z=15` y `FORECASTING_ANOMALY_NEW_COUNTERPARTY_PERCENTILE=99.5` con sus descripciones; `docs/config-reference.md` y `pnpm config:docs:check`
- [ ] 4.2 Runner `forecast-anomalies-backtest` (`apps/api/src/forecasting/anomaly-backtest-cli.ts`): argumentos opcionales `--robust-z`, `--min-ratio`, `--min-sample` y `--new-counterparty-percentile` validados con los mismos rangos de la configuración; test del parser: TC-FORECAST-ANOMALY-032

## 5. API y nightly

- [ ] 5.1 `contracts/openapi/finance-api.v1.yaml`: descripción de `SpendingAnomalyReason.categoryId` (en `COUNTERPARTY_OUTLIER`, la categoría principal); `pnpm contract:breaking` limpio
- [ ] 5.2 (bloqueado por la pregunta 2 de docs/80) `apps/api/test/perf/anomalies.perf.ts`: la fila de TC-FORECAST-ANOMALY-025 vuelve a **bloqueante** con los umbrales que fije el owner (hoy informativa por D488) y publica el informe por criterio en `reports/perf/anomalies.json`; correr la suite con el Large Seed a escala completa y registrar precisión y recall en el design
- [ ] 5.3 TC-FORECAST-ANOMALY-026 en verde: la pasada diaria con el índice por par sigue en ≤ 10 s

## 6. UI

- [ ] 6.1 Texto del motivo por contraparte con la categoría principal («3,2 veces la mediana de Pizzería Demo en Restaurantes …»), i18n es/en/pt, sin hablar de error ni de fraude: TC-FORECAST-ANOMALY-030

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar TC-FORECAST-ANOMALY-027..032 con el TC-id en el nombre del test, actualizar los tests de -005, -006, -007 y -025 y el front matter de todos
- [ ] 7.2 Regresión en verde: TC-FORECAST-ANOMALY-001..026 y TC-NOTIFICATIONS-ANOMALY-001..005

## 8. DOCUMENTATION

- [ ] 8.1 Aplicar design.md § «Cambios a docs compartidos» (docs/15 §12, config-reference, docs/23, docs/17 y docs/38)
- [ ] 8.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
