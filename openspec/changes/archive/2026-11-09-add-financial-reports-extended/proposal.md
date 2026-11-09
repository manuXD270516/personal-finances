# Propuesta: add-financial-reports-extended

## Why

`add-financial-reports` entrega el núcleo Must del catálogo de docs/14 §7 (reportes 1, 2, 3, 7, 8 y 15) y toda la infraestructura común (filtros, periodos, comparaciones, política de conversión, drill-down, CSV, reconciliación y medición). Quedan los reportes que FR-REPORTING-008 marca como Should (4 gastos por etiqueta, 5 gastos por cuenta, 6 tendencias mensuales, 9 metas de ahorro, 10 evolución de deudas, 11 costos recurrentes, 12 evolución de suscripciones, 13 conversiones de moneda y cripto, 14 comisiones), las vistas guardadas (FR-REPORTING-019, Should) y la exportación PDF (FR-REPORTING-013, Could). Con este change el catálogo queda completo para Phase 7: solo el reporte 16 (pronóstico vs real) sigue planificado para Phase 8.

## What Changes

- **Nueve reportes Should** sobre la infraestructura del núcleo, cada uno con filtros, comparaciones, política de conversión, drill-down y CSV:
  - gastos por etiqueta (coincidencia con cualquiera o con todas, aviso de no aditividad);
  - gastos por cuenta (por cuenta, tipo e institución, apilado por categoría);
  - tendencias mensuales (6/12/24 periodos, hasta 7 categorías más "Otras", normalización por día);
  - comisiones (por tipo: conversión, transferencia, préstamo y categorías de comisiones; total de los últimos 12 meses);
  - metas de ahorro (acumulado mensual por meta contra la línea esperada hasta la fecha objetivo);
  - evolución de deudas (principal pendiente al cierre de cada mes y principal e interés pagados por mes);
  - costos recurrentes (costo mensual y anual normalizado por compromiso);
  - evolución de suscripciones (costo mensual al cierre de cada mes con altas, bajas y cambios de precio);
  - conversiones de moneda y cripto (tasa efectiva frente a la de referencia por conversión y costo mensual, reutilizando el análisis de costo de Phase 5).
- **Catálogo:** los reportes 4, 5, 6, 9–14 pasan a disponibles; el 16 sigue planificado (Phase 8).
- **Vistas guardadas** (FR-REPORTING-019): guardar, listar, abrir, renombrar y borrar combinaciones de reporte y filtros, personales por usuario y workspace, con un tope de 50 por usuario y workspace.
- **PDF (Could, FR-REPORTING-013):** exportación síncrona de la tabla de un reporte con su política de conversión, generada en la API sin navegador headless (como el recorrido de auditoría).
- **Reconciliación** de los reportes nuevos con el ledger y **medición** de NFR-PERF-006 en el nightly con el Large Seed, con la misma batería del núcleo.
- **Fuera de alcance:** reporte 16 (Phase 8); XLSX y export JSON (docs/14 §12; sin FR); ECharts u otra biblioteca de gráficos salvo decisión del owner (pregunta 8 de `add-financial-reports`); valoraciones de inversiones y commodities (D221); escenarios de deuda (`debt/*` ya los tiene); cualquier cambio en el cálculo de costo de suscripciones o de conversiones (se reutilizan).

## Capabilities

### New Capabilities

- Ninguna (la capability `reporting/financial-reports` la crea `add-financial-reports`).

### Modified Capabilities

- `reporting/financial-reports`: nueve reportes, catálogo ampliado, vistas en la aplicación, vistas guardadas, aislamiento de vistas guardadas, PDF, reconciliación y rendimiento de los reportes ampliados (16 requirements ADDED: 15 Should, 1 Could).

## Impact

**Specs impactadas:** `reporting/financial-reports` (depende de que `add-financial-reports` la cree; se archiva después). Leídas sin cambios: `goals/savings-goals`, `debt/loans`, `debt/amortization`, `debt/credit-cards`, `commitments/recurrence-engine`, `commitments/subscriptions`, `fx/conversion-pricing`, `transactions/splits`, `classification/tags`, `identity/workspace-portability`, `security/access-control`.

**Componentes/contextos impactados:** REPORTING (DS puros de cada reporte, queries, CSV, PDF, repositorio de vistas guardadas). TRANSACTIONS: `summarizeNominalFlows` con `tagMatch` y `groupBy: ORIGIN` opcionales (aditivo). GOALS: `GoalProgressHistoryQuery.monthly` (nuevo). DEBT: `DebtHistoryQuery.monthly` (nuevo). COMMITMENTS: `RecurringCostQuery.listCosts` y `SubscriptionHistoryQuery.listEvents` (nuevos). FX: solo se consume `ConversionDetailQuery.listForCostAnalysis` y el agregador del costo de conversiones. IDENTITY: sección de vistas guardadas en el export del workspace (pregunta 4). `apps/api`, `apps/web`.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml`, aditivo: `GET W/reports/expenses/by-tag`, `GET W/reports/expenses/by-account`, `GET W/reports/trends`, `GET W/reports/fees`, `GET W/reports/goals`, `GET W/reports/debts`, `GET W/reports/recurring`, `GET W/reports/subscriptions`, `GET W/reports/conversions` y sus `…/export` (CSV) y `…/export.pdf` (Could); `GET`/`POST W/reports/saved-views`, `PATCH`/`DELETE W/reports/saved-views/{viewId}`. Códigos nuevos en `ErrorCode`: `SAVED_VIEW_NAME_TAKEN` (409), `SAVED_VIEW_LIMIT_EXCEEDED` (422).

**Tablas impactadas:** `reporting.saved_report_view` (nueva: `workspace_id`, `user_id`, RLS forzada por workspace y usuario, registro en `platform.workspace_scoped_table`).

**Eventos impactados:** ninguno nuevo ni consumido.

**Migraciones requeridas:** expand-only (tabla nueva con índices, políticas RLS, grants y registro); no destructiva.

**Test cases:** AÑADIDOS: TC-REPORTING-REPORTS-039..054 (16). MODIFICADOS: ninguno. DEPRECADOS: ninguno. Regresión: TC-REPORTING-REPORTS-001..038, TC-FX-COST-\*, TC-COMMITMENTS-SUBS-\* (costo de suscripciones), TC-DEBT-SUMMARY-\*, TC-GOALS-SAVINGS-\*.

**Impacto de regresión:** las vistas existentes de metas, deudas, suscripciones y costo de conversiones no cambian; el catálogo cambia el estado de 9 reportes.

**Riesgos introducidos:** RISK-029 (rendimiento; mismas filas del nightly); dependencia de contratos nuevos en GOALS, DEBT y COMMITMENTS; datos personales en las vistas guardadas (solo filtros, sin montos).

**Invariantes afectadas:** INV-001/002/020, INV-012, INV-016 (desglose de cuotas en la evolución de deudas), INV-018 (movimientos de metas), INV-021, INV-025.
