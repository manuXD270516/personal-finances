# Diseño: add-financial-reports-extended

## Contexto

Este change se apoya por completo en `add-financial-reports` (núcleo): catálogo, parámetros y esquemas `Report*`, `ReportPeriodCalendar`, `ReportComparator`, `ReportConversionPolicy`, drill-down por cursor, CSV con tope, `ETag`, métrica por reporte, filas del nightly y `ReportReconciler`. Aquí solo se agregan los reportes Should de FR-REPORTING-008, las vistas guardadas y el PDF. Se respetan las mismas decisiones del núcleo (D109, D29/D34/D38/D53, D221, D249/D311/D312/D359) y la decisión 2 del núcleo (lectura por conjunto, sin read models ni consumidores nuevos).

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| Reporting | DS puros `TagReport`, `AccountSpendReport`, `TrendMatrix`, `FeeBreakdown`, `GoalProgressSeries`, `DebtEvolutionSeries`, `RecurringCostTable`, `SubscriptionCostSeries`, `ConversionScatter` | domain | Nuevos (TDD) |
| Reporting | Una query por reporte; `SavedReportViews` (comandos y consultas); exportador PDF | application | Nuevos |
| Reporting | `reporting.saved_report_view` y su repositorio | infrastructure | Nuevo |
| Transactions | `summarizeNominalFlows`: `tagMatch` (`ANY`/`ALL`) y `groupBy: ORIGIN` opcionales | application (contracts) | Aditivo |
| Goals | `GoalProgressHistoryQuery.monthly` | application (contracts) | Nuevo |
| Debt | `DebtHistoryQuery.monthly` | application (contracts) | Nuevo |
| Commitments | `RecurringCostQuery.listCosts`, `SubscriptionHistoryQuery.listEvents` | application (contracts) | Nuevos |
| FX | `ConversionDetailQuery.listForCostAnalysis` y `ConversionCostAggregator` | — | Se reutilizan |
| Identity | Sección `saved-report-views` del export del workspace (pregunta 4) | infrastructure | Aditivo |
| apps/api, apps/web | Endpoints y vistas `/reportes/<slug>` | interface | Nuevos |

## Objetivos / No objetivos

**Objetivos:**
- Completar el catálogo de Phase 7 (15 de 16 reportes disponibles).
- Vistas guardadas personales y, si el tiempo alcanza, PDF.

**No objetivos:**
- Pronóstico vs real (Phase 8), XLSX, JSON, read models, cambios en los cálculos ya aprobados de costo de suscripciones, costo de conversiones, seguimiento de metas o desglose de cuotas.

## Decisiones

1. **Dependencia del núcleo.** Este change no redefine filtros, comparaciones, conversión, drill-down ni CSV: los reportes nuevos los heredan por construcción (mismos parámetros y esquemas). Se implementa y archiva después de `add-financial-reports`; su delta agrega requirements a la capability que aquel crea.
2. **Gastos por etiqueta y por cuenta.** `summarizeNominalFlows` con `withTags`/`tagMatch` y con `groupBy: ['ACCOUNT']` (del núcleo). Etiqueta "cualquiera": una porción suma en cada etiqueta pedida que tenga; "todas": solo las porciones con todas. El aviso de no aditividad es un campo `nonAdditive: true` en la respuesta. La cuenta es la de la pata de usuario que paga (decisión 3 del núcleo); tipo e institución del catálogo de ACCOUNTS.
3. **Tendencias.** Matriz categoría × periodo sobre la misma consulta; top 7 por consolidado del rango (empate por nombre) y "Otras categorías"; `normalize=PER_DAY` divide cada celda por los días de su periodo. Rango 6, 12 o 24 periodos (el tope de 24 del núcleo).
4. **Comisiones.** `groupBy: ['ORIGIN']` agrega a cada fila el tipo de la transacción y el rol de la porción (`NOMINAL`/`FEE`). Clasificación, en este orden y exclusiva: porción `FEE` de una conversión → conversión; porción `FEE` de una transferencia → transferencia; porciones de interés, cargos, seguro e impuestos de un `LOAN_PAYMENT` → préstamos; resto de porciones de gasto en categorías del grupo de comisiones del sistema → categorías de comisiones. Los intereses de tarjeta dependen de cómo `debt/credit-cards` los registra (pregunta 2).
5. **Metas.** `GoalProgressHistoryQuery.monthly({workspaceId, goalIds?, from, to})` devuelve por meta y mes: aportes, retiros, acumulado al cierre, objetivo, fechas y el seguimiento (`expected`, `status`) que GOALS ya calcula para una fecha de corte (sin reasignaciones como aportes, INV-018). REPORTING no reimplementa el seguimiento.
6. **Deudas.** Saldo pendiente: `AccountBalanceHistoryQuery.getAccountBalancesAtDates` sobre las cuentas `LIABILITY` de préstamos y tarjetas (mapa deuda → cuenta de `LoanPortfolioQuery` y `CardPortfolioQuery`) al cierre de cada mes. Pagado: `DebtHistoryQuery.monthly({workspaceId, from, to})` con principal, interés y cargos por préstamo y mes desde el desglose de cada pago (INV-016). Saldos a la tasa de cada cierre; pagos con `FlowValuation`.
7. **Costos recurrentes y suscripciones.** `RecurringCostQuery.listCosts({workspaceId})` normaliza cada definición activa de egreso con la regla as-built de `GetSubscriptionCostSummary` (renovaciones por año / 12; montos variables sin monto, contados aparte). `SubscriptionHistoryQuery.listEvents({workspaceId, from, to})` devuelve altas, bajas y cambios de versión de precio con fecha; el costo mensual al cierre se calcula en REPORTING sumando los precios normalizados vigentes en cada cierre y valorándolos con la tasa de ese cierre.
8. **Conversiones.** Puntos por conversión desde `ConversionDetailQuery.listForCostAnalysis` (revisión vigente, sin anuladas ni pendientes); costo mensual con `ConversionCostAggregator` agrupado por mes calendario o periodo (misma regla, mismas exclusiones). El reporte enlaza a `/fx/costos` para el detalle por canal.
9. **Vistas guardadas.** Tabla `reporting.saved_report_view` (`id` uuid v7, `workspace_id`, `user_id`, `report_id`, `name` (1..80), `params` jsonb validado por esquema (sin montos), `created_at`, `updated_at`); `UNIQUE (workspace_id, user_id, report_id, lower(name))`; tope de 50 por `(workspace_id, user_id)` verificado con bloqueo de fila del usuario. RLS forzada con política `workspace_id = current_workspace_id AND user_id = current_user_id` (fail-closed, sin contexto no devuelve filas), grants a `pf_app`, registro en `platform.workspace_scoped_table`. Rango relativo (`LAST_N_PERIODS`, `CURRENT_PERIOD`, `PREVIOUS_PERIOD`) o fijo. Borrado físico (preferencia personal sin valor contable) y sin auditoría (como la disposición del Home; pregunta 3). Al abrir, los ids inexistentes o archivados se informan en `warnings[]`.
10. **PDF (Could).** Generación síncrona con la misma librería que el recorrido de auditoría (sin navegador headless): título, rango, filtros, tabla de datos, política de conversión y tasas; mismo tope de filas y cuota `costly`. Sin gráficos en la primera versión.
11. **Medición.** Filas nuevas del nightly con el Large Seed (rango fijo del núcleo): `report-expenses-by-tag-12m`, `report-expenses-by-account-12m`, `report-trends-24m`, `report-fees-12m`, `report-goals-12m`, `report-debts-12m`, `report-recurring`, `report-subscriptions-12m`, `report-conversions-12m`; todas p95 ≤ 800 ms y bloqueantes (pregunta 5); el drill-down reutiliza las filas del núcleo. El Large Seed no tiene metas ni préstamos: la prueba crea 5 metas con 24 movimientos y 2 préstamos con su historial de pagos antes de medir.

## Contratos

**OpenAPI** (aditivo; `x-openspec-capability: reporting/financial-reports`; VIEWER salvo vistas guardadas, que exigen ser el dueño de la vista):

| Operación | Método y ruta |
|---|---|
| `getExpensesByTagReport` / `exportExpensesByTagReport` | `GET W/reports/expenses/by-tag?{común}&tagMatch` / `…/export` |
| `getExpensesByAccountReport` / `export…` | `GET W/reports/expenses/by-account?{común}` / `…/export` |
| `getTrendsReport` / `export…` | `GET W/reports/trends?{común}&normalize` / `…/export` |
| `getFeesReport` / `export…` | `GET W/reports/fees?{común}` / `…/export` |
| `getGoalsReport` / `export…` | `GET W/reports/goals?from&to&goalId[]&reportingCurrency` / `…/export` |
| `getDebtsReport` / `export…` | `GET W/reports/debts?from&to&debtKind&reportingCurrency` / `…/export` |
| `getRecurringCostsReport` / `export…` | `GET W/reports/recurring?reportingCurrency&categoryId[]` / `…/export` |
| `getSubscriptionsReport` / `export…` | `GET W/reports/subscriptions?from&to&reportingCurrency` / `…/export` |
| `getConversionsReport` / `export…` | `GET W/reports/conversions?{común}` / `…/export` |
| `exportReportPdf` (Could) | `GET W/reports/{reportSlug}/export.pdf?…` (`application/pdf`, `x-rate-limit: costly`) |
| `listSavedReportViews` | `GET W/reports/saved-views?reportId` |
| `createSavedReportView` | `POST W/reports/saved-views` (201; `Idempotency-Key` opcional) |
| `updateSavedReportView` | `PATCH W/reports/saved-views/{viewId}` (`If-Match`) |
| `deleteSavedReportView` | `DELETE W/reports/saved-views/{viewId}` (204) |

Esquemas: `ExpensesByTagReport {meta, nonAdditive: true, tags[{tagId, name, amount: ReportAmount, comparison}]}`, `ExpensesByAccountReport {meta, accounts[{accountId, name, type, institutionId|null, amount, byCategory[{categoryId, amount}]}], total}`, `TrendsReport {meta, normalized, series[{categoryId|null (Otras), name, cells[{period, amount}]}]}`, `FeesReport {meta, months[{period, byType[{type: CONVERSION|TRANSFER|LOAN|FEE_CATEGORY (x-extensible-enum), amount}], total}], last12Months: ReportAmount}`, `GoalsReport {meta, goals[{goalId, name, currency, target: Money, months[{period, contributions, withdrawals, accumulated, expected: Money|null, status}]}]}`, `DebtsReport {meta, debts[{debtId, kind: LOAN|CARD, name, currency, months[{period, outstanding: Money, principalPaid: Money|null, interestPaid: Money|null}]}]}`, `RecurringCostsReport {meta, items[{definitionId, name, categoryId, cadence, monthly: Money|null, annual: Money|null, variable: boolean}], totals {monthly, annual}, variableCount}`, `SubscriptionsReport {meta, months[{period, monthlyCost: ReportAmount, events[{date, subscriptionId, name, kind: STARTED|CANCELLED|PRICE_CHANGED, previousPrice|null, newPrice|null}]}]}`, `ConversionsReport {meta, points[{transactionId, date, pair, effectiveRate, referenceRate|null}], months[{period, cost: Money, conversions, excluded}]}`, `SavedReportView {id, reportId, name, params, createdAt, updatedAt, warnings[]}`. `ErrorCode`: `SAVED_VIEW_NAME_TAKEN` (409), `SAVED_VIEW_LIMIT_EXCEEDED` (422).

**Contratos entre módulos** (aditivos):

```ts
// @pf/transactions/contracts — summarizeNominalFlows
tagMatch?: 'ANY' | 'ALL';                       // con tagIds
groupBy?: readonly ('ACCOUNT' | 'COUNTERPARTY' | 'ORIGIN')[];
// fila: + origin?: { transactionKind: string; portionRole: 'NOMINAL' | 'FEE'; loanComponent?: 'INTEREST' | 'CHARGES' | 'INSURANCE' | 'TAXES' | null }
// @pf/goals/contracts
interface GoalProgressHistoryQuery { monthly(input: { workspaceId: string; goalIds?: readonly string[]; from: string; to: string }):
  Promise<readonly { goalId: string; name: string; currency: string; target: MoneyDto; startDate: string; targetDate: string | null;
    months: readonly { monthEnd: string; contributions: MoneyDto; withdrawals: MoneyDto; accumulated: MoneyDto;
      expected: MoneyDto | null; status: 'BEHIND' | 'ON_TRACK' | 'AHEAD' | null }[] }[]> }
// @pf/debt/contracts
interface DebtHistoryQuery { monthly(input: { workspaceId: string; from: string; to: string }):
  Promise<readonly { loanId: string; month: string; currency: string; principal: string; interest: string; charges: string }[]> }
// @pf/commitments/contracts
interface RecurringCostQuery { listCosts(input: { workspaceId: string }): Promise<readonly { definitionId: string; name: string;
  categoryId: string | null; cadence: string; interval: number; currency: string; renewalsPerYear: string | null;
  price: string | null; variable: boolean }[]> }
interface SubscriptionHistoryQuery { listEvents(input: { workspaceId: string; from: string; to: string }): Promise<readonly {
  subscriptionId: string; name: string; date: string; kind: 'STARTED' | 'CANCELLED' | 'PRICE_CHANGED';
  previousPrice: MoneyDto | null; newPrice: MoneyDto | null; renewalsPerYear: string }[]> }
```

Todos sin efectos, en la unidad de trabajo del llamador, sin consultas en paralelo.

**Eventos:** ninguno.

## Riesgos / Trade-offs

- [Contratos nuevos en tres contextos] → aditivos y de solo lectura; cada uno con su test de contrato en su contexto.
- [Clasificación de comisiones] → orden y exclusividad fijos (decisión 4); intereses de tarjeta según pregunta 2.
- [Vistas guardadas con datos de filtros] → solo ids y parámetros, sin montos; RLS por usuario.
- [Rendimiento de tendencias de 24 meses] → fila bloqueante; mismo recurso de colapso por periodo del núcleo si hiciera falta.

## Plan de migración

1. Migración expand-only `reporting.saved_report_view` (tabla, índices, RLS forzada, grants, `platform.workspace_scoped_table`, sección de portabilidad), timestamp posterior a la última de `main`.
2. Contratos aditivos en TRANSACTIONS, GOALS, DEBT y COMMITMENTS; luego reportes, API y UI.
3. Rollback: retirar rutas; la tabla queda inerte (sin datos financieros).

## Preguntas abiertas

1. **Orden respecto del núcleo.** (a) **Implementar después de `add-financial-reports` archivado**; (b) en paralelo una vez fusionados los contratos del núcleo. **Recomendación: (a).** Bloquea el orden de implementación.
2. **Intereses de tarjeta en el reporte de comisiones y en la evolución de deudas.** (a) **Contarlos si `debt/credit-cards` los registra como porciones con un rol identificable; si no, mostrar solo el saldo pendiente de la tarjeta** y abrir un change en DEBT; (b) inferirlos por categoría. **Recomendación: (a)**. No bloquea la spec; se verifica al implementar el grupo 3.
3. **Auditoría de las vistas guardadas.** (a) **Sin auditoría** (preferencia personal, como la disposición del Home); (b) auditar alta, cambio y baja. **Recomendación: (a).** No bloquea.
4. **Vistas guardadas en el export del workspace.** (a) **Incluirlas** (portabilidad completa de las preferencias); (b) excluirlas. **Recomendación: (a).** No bloquea.
5. **Filas del nightly de los reportes ampliados.** (a) **Bloqueantes** (NFR-PERF-006 aplica a todos los reportes agregados); (b) informativas mientras los reportes son Should. **Recomendación: (a).** No bloquea.
6. **PDF en Phase 7.** Cierra docs/14 pregunta 8. (a) **Implementarlo en este change si el resto está terminado (Could)**; (b) diferirlo. **Recomendación: (a).** No bloquea.

## Cambios a docs compartidos

- `docs/01-functional-requirements.md`: FR-REPORTING-008 (estado final por reporte), FR-REPORTING-013 y FR-REPORTING-019 con el as-built.
- `docs/10-api-design.md`: endpoints de §13.6 ampliados y `SAVED_VIEW_NAME_TAKEN`, `SAVED_VIEW_LIMIT_EXCEEDED` en §9.1.
- `docs/08-data-model.md`: `reporting.saved_report_view` con su RLS.
- `docs/14-reporting.md`: §7 (fuente as-built de los reportes 4–6 y 9–14), §12 (PDF síncrono), pregunta 8 cerrada.
- `docs/23-ci-cd.md` §5.5: filas `report-*` ampliadas.
- `docs/38-estado-y-pendientes.md`: estado y preguntas.
