# Tareas

> Depende de `add-financial-reports` (contratos, esquemas `Report*`, drill-down, CSV, UI base, reconciliación y filas del nightly): se implementa **después** de que ese change esté archivado (pregunta 1 de design.md, bloquea el orden). Sin consumidores nuevos ni cambios del presupuesto de conexiones. Sin Docker, `test:integration`, `test:e2e` y el nightly los valida CI.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar el delta de `reporting/financial-reports`; `pnpm exec openspec validate add-financial-reports-extended --strict`
- [ ] 1.2 Revisar TC-REPORTING-REPORTS-039..054 contra los scenarios con las cifras a mano (69.00 + 1200.00 / 12 + 50.00 × 10.00 = 669.00 BOB y 8028.00 BOB al año; 2.00 + 5.00 + 400.00 + 15.00 = 422.00 BOB; 20000.00 − 1100.00 − 1110.00 = 17790.00 BOB); pasar a `ready` y `requirement_status: confirmed`

## 2. DOMAIN (TDD)

- [ ] 2.1 `TagReport` y `AccountSpendReport` test-first: coincidencia cualquiera/todas, aviso de no aditividad, Σ cuentas = gasto (TC-REPORTING-REPORTS-039, TC-REPORTING-REPORTS-040)
- [ ] 2.2 `TrendMatrix` test-first: top 7 y "Otras categorías", normalización por día (TC-REPORTING-REPORTS-041)
- [ ] 2.3 `FeeBreakdown` test-first: clasificación exclusiva en el orden de la decisión 4 y total de 12 meses (TC-REPORTING-REPORTS-042)
- [ ] 2.4 `GoalProgressSeries`, `DebtEvolutionSeries`, `RecurringCostTable`, `SubscriptionCostSeries` y `ConversionScatter` test-first (TC-REPORTING-REPORTS-043, TC-REPORTING-REPORTS-044, TC-REPORTING-REPORTS-045, TC-REPORTING-REPORTS-046, TC-REPORTING-REPORTS-047)
- [ ] 2.5 Identidades nuevas en `ReportReconciler` y PBT con timeout explícito (TC-REPORTING-REPORTS-052)
- [ ] 2.6 Catálogo: los 9 reportes a `AVAILABLE` (TC-REPORTING-REPORTS-048)

## 3. APPLICATION

- [ ] 3.1 TRANSACTIONS: `tagMatch` y `groupBy: ORIGIN` opcionales en `summarizeNominalFlows` (regresión de TC-REPORTING-REPORTS-001..038 y del Home) (TC-REPORTING-REPORTS-039, TC-REPORTING-REPORTS-042)
- [ ] 3.2 GOALS `GoalProgressHistoryQuery.monthly`, DEBT `DebtHistoryQuery.monthly`, COMMITMENTS `RecurringCostQuery.listCosts` y `SubscriptionHistoryQuery.listEvents`, con tests en cada contexto; verificar cómo `debt/credit-cards` registra los intereses (pregunta 2) (TC-REPORTING-REPORTS-043, TC-REPORTING-REPORTS-044, TC-REPORTING-REPORTS-045, TC-REPORTING-REPORTS-046)
- [ ] 3.3 Queries de los nueve reportes, una unidad de trabajo y una resolución de tasas por petición (TC-REPORTING-REPORTS-039..047)
- [ ] 3.4 Vistas guardadas: crear, listar, abrir con avisos, renombrar y borrar; nombre único y tope de 50 (TC-REPORTING-REPORTS-049, TC-REPORTING-REPORTS-050)
- [ ] 3.5 Exportador PDF (Could) (TC-REPORTING-REPORTS-051)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand-only de `reporting.saved_report_view` (RLS forzada por workspace y usuario, grants, `platform.workspace_scoped_table`, sección de portabilidad según pregunta 4); timestamp posterior a la última de `main`
- [ ] 4.2 Tests de integración de los adapters nuevos y de las vistas guardadas con aislamiento entre usuarios y workspaces (TC-REPORTING-REPORTS-050); reconciliación con el dataset Demo (TC-REPORTING-REPORTS-052); `pnpm test:integration` dos veces en verde
- [ ] 4.3 Filas `report-*` ampliadas en `nightly.perf.ts` con metas y préstamos creados por la prueba (TC-REPORTING-REPORTS-053)

## 5. API

- [ ] 5.1 OpenAPI: operaciones de los nueve reportes, sus exportaciones, PDF (Could) y vistas guardadas; `SAVED_VIEW_NAME_TAKEN` y `SAVED_VIEW_LIMIT_EXCEEDED`; `pnpm contract:lint` y `pnpm contract:breaking` limpios
- [ ] 5.2 Controllers y tests de API: roles, aislamiento, `ETag`, errores de vistas guardadas (TC-REPORTING-REPORTS-049, TC-REPORTING-REPORTS-050)

## 6. UI

- [ ] 6.1 Vistas `/reportes/<slug>` de los nueve reportes con filtros, gráfico y tabla, drill-down y exportación; menú de vistas guardadas en la barra de filtros; i18n es/en/pt; axe y móvil (TC-REPORTING-REPORTS-054)

## 7. TESTS AUTOMATIZADOS y E2E

- [ ] 7.1 E2E: etiqueta → categoría → porción, guardar y reabrir una vista; con `PF_E2E_PROJECT` (TC-REPORTING-REPORTS-054)
- [ ] 7.2 Regresión: TC-REPORTING-REPORTS-001..038, TC-FX-COST-\*, TC-COMMITMENTS-SUBS-\*, TC-DEBT-SUMMARY-\*, TC-GOALS-SAVINGS-\*

## 8. DOCS

- [ ] 8.1 Aplicar la lista "Cambios a docs compartidos" de design.md
- [ ] 8.2 Estados de los TC a `automated`; `pnpm traceability:check`, `pnpm format:check`, `pnpm spec:validate`
