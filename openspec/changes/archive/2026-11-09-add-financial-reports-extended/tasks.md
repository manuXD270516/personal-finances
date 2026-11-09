# Tareas

> Depende de `add-financial-reports` (contratos, esquemas `Report*`, drill-down, CSV, UI base, reconciliación y filas del nightly): se implementa **después** de que ese change esté archivado (pregunta 1 de design.md, bloquea el orden). Sin consumidores nuevos ni cambios del presupuesto de conexiones. Sin Docker, `test:integration`, `test:e2e` y el nightly los valida CI.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar el delta de `reporting/financial-reports`; `pnpm exec openspec validate add-financial-reports-extended --strict` — 2026-11-05: `openspec validate add-financial-reports-extended --strict` en verde (spec:validate: 64 de 64).
- [x] 1.2 Revisar TC-REPORTING-REPORTS-039..054 contra los scenarios con las cifras a mano (69.00 + 1200.00 / 12 + 50.00 × 10.00 = 669.00 BOB y 8028.00 BOB al año; 2.00 + 5.00 + 400.00 + 15.00 = 422.00 BOB; 20000.00 − 1100.00 − 1110.00 = 17790.00 BOB); pasar a `ready` y `requirement_status: confirmed` — 2026-11-05: cifras del seguimiento verificadas contra las pruebas (669.00 / 8028.00 BOB, 422.00 BOB, 94/99/149/80 BOB, 18900.00 y 17790.00 BOB); TC 039..054 a `requirement_status: confirmed`.

## 2. DOMAIN (TDD)

- [x] 2.1 `TagReport` y `AccountSpendReport` test-first: coincidencia cualquiera/todas, aviso de no aditividad, Σ cuentas = gasto (TC-REPORTING-REPORTS-039, TC-REPORTING-REPORTS-040) — 2026-11-05: `extended-reports.ts` (`TagReport`, `AccountSpendReport`) con `extended-reports.domain.test.ts`.
- [x] 2.2 `TrendMatrix` test-first: top 7 y "Otras categorías", normalización por día (TC-REPORTING-REPORTS-041) — 2026-11-05: `TrendMatrix` (7 series + «Otras categorías», `PER_DAY`; febrero y marzo = 100.00 BOB por día).
- [x] 2.3 `FeeBreakdown` test-first: clasificación exclusiva en el orden de la decisión 4 y total de 12 meses (TC-REPORTING-REPORTS-042) — 2026-11-05: `FeeBreakdown` y `classifyFee` (conversión → transferencia → préstamo → categorías `FEES`, exclusiva; total de 12 periodos).
- [x] 2.4 `GoalProgressSeries`, `DebtEvolutionSeries`, `RecurringCostTable`, `SubscriptionCostSeries` y `ConversionScatter` test-first (TC-REPORTING-REPORTS-043, TC-REPORTING-REPORTS-044, TC-REPORTING-REPORTS-045, TC-REPORTING-REPORTS-046, TC-REPORTING-REPORTS-047) — 2026-11-05: `GoalProgressSeries`, `DebtEvolutionSeries`, `RecurringCostTable`, `SubscriptionCostSeries` y `ConversionScatter`.
- [x] 2.5 Identidades nuevas en `ReportReconciler` y PBT con timeout explícito (TC-REPORTING-REPORTS-052) — 2026-11-05: `ReportReconciler.accountSum/feeTypesWithinExpenses/debtOutstanding/goalAccumulated` y PBT de Σ cuentas (timeout explícito). Hallazgo: con un gasto neto negativo Σ comisiones ≤ gasto no aplica (un reembolso de otra categoría puede dejarlo por debajo), así que se omite en ese caso.
- [x] 2.6 Catálogo: los 9 reportes a `AVAILABLE` (TC-REPORTING-REPORTS-048) — 2026-11-05: catálogo con 15 `AVAILABLE` y `FORECAST_VS_ACTUAL` planificado (TC-REPORTING-REPORTS-048).

## 3. APPLICATION

- [x] 3.1 TRANSACTIONS: `tagMatch` y `groupBy: ORIGIN` opcionales en `summarizeNominalFlows` (regresión de TC-REPORTING-REPORTS-001..038 y del Home) (TC-REPORTING-REPORTS-039, TC-REPORTING-REPORTS-042) — 2026-11-05: `tagMatch` (`ANY`/`ALL`) y `groupBy: ORIGIN` aditivos en TRANSACTIONS (también `listPortions` para el drill-down); regresión 001..038 y Home en verde.
- [x] 3.2 GOALS `GoalProgressHistoryQuery.monthly`, DEBT `DebtHistoryQuery.monthly`, COMMITMENTS `RecurringCostQuery.listCosts` y `SubscriptionHistoryQuery.listEvents`, con tests en cada contexto; verificar cómo `debt/credit-cards` registra los intereses (pregunta 2) (TC-REPORTING-REPORTS-043, TC-REPORTING-REPORTS-044, TC-REPORTING-REPORTS-045, TC-REPORTING-REPORTS-046) — 2026-11-05: `GoalProgressHistoryQuery.monthly`, `DebtHistoryQuery.monthly` (pagos con fecha), `RecurringCostQuery.listCosts` y `SubscriptionHistoryQuery.listEvents`, cada uno con su prueba. **Pregunta 2 (D372):** `debt/credit-cards` no registra intereses como porciones del ledger, así que no se cuentan en comisiones ni en deudas (solo el saldo de la tarjeta); registrarlos requiere un change nuevo en DEBT.
- [x] 3.3 Queries de los nueve reportes, una unidad de trabajo y una resolución de tasas por petición (TC-REPORTING-REPORTS-039..047) — 2026-11-05: `ExtendedReportsQueries` (una unidad de trabajo, una resolución de tasas, lecturas secuenciales); la composición enlaza GOALS, DEBT y COMMITMENTS con resolución tardía.
- [x] 3.4 Vistas guardadas: crear, listar, abrir con avisos, renombrar y borrar; nombre único y tope de 50 (TC-REPORTING-REPORTS-049, TC-REPORTING-REPORTS-050) — 2026-11-05: `SavedReportViewsService` (crear, listar, abrir con avisos, renombrar con `If-Match`, borrar) con `SAVED_VIEW_NAME_TAKEN` y `SAVED_VIEW_LIMIT_EXCEEDED`; el tope se verifica bajo un bloqueo de asesoría por (workspace, usuario).
- [x] 3.5 Exportador PDF (Could) (TC-REPORTING-REPORTS-051) — 2026-11-05: **diferida (Could)** por falta de tiempo; D376 la condicionaba a que el resto estuviera terminado. TC-REPORTING-REPORTS-051 queda `ready` sin automatizar. Diferimiento confirmado por el owner (D401, 2026-11-09). Pendiente para una fase posterior: generación síncrona con pdfkit (título, rango, filtros, tabla, política de conversión y tasas) y `exportReportPdf`.

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand-only de `reporting.saved_report_view` (RLS forzada por workspace y usuario, grants, `platform.workspace_scoped_table`, sección de portabilidad según pregunta 4); timestamp posterior a la última de `main` — 2026-11-05: migración `20261107100000_reporting_saved_report_view.sql` (RLS forzada por workspace y usuario, grants, `platform.workspace_scoped_table` orden 171) y sección de portabilidad `saved-report-views` (orden 820; D374).
- [x] 4.2 Tests de integración de los adapters nuevos y de las vistas guardadas con aislamiento entre usuarios y workspaces (TC-REPORTING-REPORTS-050); reconciliación con el dataset Demo (TC-REPORTING-REPORTS-052); `pnpm test:integration` dos veces en verde — 2026-11-05: integración de TRANSACTIONS (`tagMatch`, `ORIGIN`), API contra PostgreSQL real (metas, préstamo, recurrentes y suscripción reales, aislamiento entre usuarios y workspaces con RLS) y reconciliación con Demo v2 (Σ cuentas, comisiones, deudas); ver las corridas de `pnpm test:integration` del informe.
- [x] 4.3 Filas `report-*` ampliadas en `nightly.perf.ts` con metas y préstamos creados por la prueba (TC-REPORTING-REPORTS-053) — 2026-11-05: nueve filas `report-*` ampliadas en `nightly.perf.ts` con 5 metas y 2 préstamos creados por la prueba, bloqueantes con p95 ≤ 800 ms (D375). Escritas y verificadas por tipos; el nightly lo ejecuta CI (pendiente confirmar a escala 1).

## 5. API

- [x] 5.1 OpenAPI: operaciones de los nueve reportes, sus exportaciones, PDF (Could) y vistas guardadas; `SAVED_VIEW_NAME_TAKEN` y `SAVED_VIEW_LIMIT_EXCEEDED`; `pnpm contract:lint` y `pnpm contract:breaking` limpios — 2026-11-05: 24 operaciones nuevas (nueve reportes + exportaciones + `getSavedReportView` + las cuatro de vistas) y los dos códigos; oasdiff sin cambios incompatibles, Spectral sin errores y Redocly válido.
- [x] 5.2 Controllers y tests de API: roles, aislamiento, `ETag`, errores de vistas guardadas (TC-REPORTING-REPORTS-049, TC-REPORTING-REPORTS-050) — 2026-11-05: controllers y pruebas de API (roles, aislamiento, `ETag`/304, errores de las vistas); `financial-reports-extended.api.test.ts`.

## 6. UI

- [x] 6.1 Vistas `/reportes/<slug>` de los nueve reportes con filtros, gráfico y tabla, drill-down y exportación; menú de vistas guardadas en la barra de filtros; i18n es/en/pt; axe y móvil (TC-REPORTING-REPORTS-054) — 2026-11-05: vistas `/reportes/<slug>` de los nueve reportes (`ExtendedViews.tsx`), menú de vistas guardadas (`SavedViewsPanel.tsx`), i18n es/en/pt y pruebas de renderizado; axe y móvil en el E2E.

## 7. TESTS AUTOMATIZADOS y E2E

- [x] 7.1 E2E: etiqueta → categoría → porción, guardar y reabrir una vista; con `PF_E2E_PROJECT` (TC-REPORTING-REPORTS-054) — 2026-11-05: E2E de etiqueta → categoría → porción → transacción, guardar la vista con rango relativo y reabrirla (ver el informe para la corrida con `PF_E2E_PROJECT`).
- [x] 7.2 Regresión: TC-REPORTING-REPORTS-001..038, TC-FX-COST-\*, TC-COMMITMENTS-SUBS-\*, TC-DEBT-SUMMARY-\*, TC-GOALS-SAVINGS-\* — 2026-11-05: regresión de TC-REPORTING-REPORTS-001..038, TC-FX-COST, TC-COMMITMENTS-SUBS, TC-DEBT-SUMMARY y TC-GOALS-SAVINGS en verde (unitarios y de integración).

## 8. DOCS

- [x] 8.1 Aplicar la lista "Cambios a docs compartidos" de design.md — 2026-11-05: docs/01, 08, 10, 14, 23 y 38 actualizados (docs/38 con el hallazgo de D372).
- [x] 8.2 Estados de los TC a `automated`; `pnpm traceability:check`, `pnpm format:check`, `pnpm spec:validate` — 2026-11-05: TC 039..050 y 052..054 `automated`; 051 `ready`; `traceability:check`, `format:check` y `spec:validate` en verde.
