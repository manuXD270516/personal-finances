# Propuesta: add-historical-budgets

## Why

Phase 7 (docs/24 §5.7) incluye en su alcance los presupuestos "average/historical-based". FR-PLANNING-021 los define como el promedio de los últimos N periodos cerrados y como el mismo periodo del año anterior ± un ajuste porcentual (Could, Phase 7; US-231 en docs/25). Hoy el plan mensual (`planning/budgets`) solo se llena a mano, desde un template versionado o clonando el periodo anterior (`planning/budget-templates`). Ninguna de esas vías mira lo que realmente se gastó, y los montos de un template quedan viejos sin que nadie lo note. El owner ya tiene meses de historia registrada (imports de Phase 6) y la usa para responder "¿estoy dentro del plan?" (Q3 del Home). Una sugerencia que salga de esa historia, que explique su cálculo y que se aplique solo cuando él la revisa reduce la fricción de armar el plan (RISK-025) sin quitarle el control.

## What Changes

- **Sugerencia por promedio** de los últimos N periodos financieros terminados (N de 1 a 12, 6 por omisión). Usa la misma derivación del real y la misma valoración en moneda base que el progreso del presupuesto (D109 FlowValuation), redondea HALF_EVEN y cuenta como 0.00 un periodo sin movimientos.
- **Exclusión de periodos incompletos** (anteriores a la primera actividad, que la contienen o con montos sin tasa) y de **valores atípicos** con las vallas de Tukey (1.5 × RIC) cuando hay al menos 4 valores. Con menos de la mitad de N en valores válidos, la línea queda en `INSUFFICIENT_HISTORY`. El EDITOR puede excluir un periodo a mano o volver a incluir uno atípico.
- **Método del mismo periodo del año anterior** con un ajuste de −100 % a +1000 % (aplicable también al promedio) y **redondeo opcional** a múltiplos de 1, 5, 10, 50 o 100 (Could).
- **Explicación estructurada** por línea: periodos con real y estado, valores usados, promedio, mediana, ajuste, redondeo, monto vigente y diferencia. La UI arma el texto en es/en/pt.
- **Aplicación como borrador revisable:** la vista previa no tiene efectos. Una confirmación explícita aplica solo las líneas elegidas, con el monto sugerido o uno escrito a mano. Crea el plan si no existe y guarda la base de cada sugerencia en la línea. `BUDGET_SUGGESTION_STALE` si la historia o el plan cambiaron entre la vista previa y la confirmación.
- **Nunca automático:** ni la creación de periodos, ni el template predeterminado, ni el clonado, ni la propagación, ni el rollover calculan sugerencias, y una línea aplicada no se recalcula sola.
- Portabilidad de la base histórica en el export del workspace.
- **Fuera de alcance:** tipos de línea nuevos que se recalculen cada periodo (pregunta 1); sugerencias sobre templates o "guardar como template"; pronóstico o tendencia (Phase 8, `forecast/*`); detección de anomalías por transacción (FR-FORECAST-010); reportes de tendencia (`reporting/financial-reports`, otro change de Phase 7); notificaciones; métodos de mediana o percentil.

## Capabilities

### New Capabilities
- Ninguna.

### Modified Capabilities
- `planning/budgets`: 14 requirements ADDED (3 Must, 1 Should, 10 Could): promedio, periodos incompletos, historia insuficiente, atípicos, exclusión manual, año anterior con ajuste, redondeo a múltiplos, explicación, líneas alcanzadas, aplicación con confirmación, sugerencia obsoleta, sin aplicación automática, permisos y auditoría, rendimiento.
- `identity/workspace-portability`: 1 requirement ADDED (Must): base histórica de las líneas en el export.

## Impact

**Specs impactadas:** `planning/budgets` (ADDED) e `identity/workspace-portability` (ADDED). Lee sin modificarlas `planning/financial-periods` (calendario de periodos y primera actividad), `planning/budget-templates` (línea modificada, clonado y propagación), `reporting/dashboard` (misma valoración de flujos, D109), `audit/audit-trail` y `security/access-control`.

**Componentes/contextos impactados:** Planning (`@pf/planning`):
- domain: DS `HistoricalBudgetEstimator` (puro: ventana, estados por periodo, vallas de Tukey, promedio, mediana, ajuste, redondeo) y VO `HistoryBasis`.
- application: `BudgetSuggestionService.preview` y `.confirm`, reutilizando `BudgetCalculator` para el real y la valoración.
- infrastructure: columna nueva en `PgBudgetRepository` y sección del export.
- interface: controller `budget-suggestions`.

`apps/api` (rutas, OpenAPI, benchmark nightly) y `apps/web` (pantalla "Sugerir desde el historial" en el plan, con selección, edición y explicación). Sin cambios en otros contextos: consume contratos existentes (`NominalFlowQuery`, `FxValuationPort`, `CategoryCatalogQuery`, `LedgerActivityRangeQuery`).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml`, aditivo:
- operaciones nuevas `previewBudgetSuggestions` (`POST W/budget-suggestions/preview`) y `confirmBudgetSuggestions` (`POST W/budget-suggestions/confirm`);
- propiedad opcional `historyBasis` en `BudgetLine`;
- código nuevo `BUDGET_SUGGESTION_STALE` (409) en `ErrorCode`.

Detalle en design.md § Contratos.

**Tablas impactadas:** `planning.budget_line` gana `history_basis jsonb NULL`. Sin tablas nuevas.

**Eventos impactados:** ninguno nuevo. La confirmación que crea un plan emite `planning.BudgetCreated.v1` como hoy (origen `EMPTY`). Los cambios de líneas reevalúan umbrales con el mecanismo existente (`planning.BudgetThresholdReached.v1` sin cambio de esquema).

**Migraciones requeridas:** expand, no destructiva: `ALTER TABLE planning.budget_line ADD COLUMN history_basis jsonb NULL` (sin default ni reescritura) y CHECK `jsonb_typeof(history_basis) = 'object'` con `NOT VALID` + `VALIDATE`. RLS sin cambios (la tabla ya está registrada en `platform.workspace_scoped_table`).

**Test cases:**
- AÑADIDOS: TC-PLANNING-HISTBUDGET-001..031 (31).
- MODIFICADOS: ninguno.
- DEPRECADOS: ninguno.

**Impacto de regresión:** `BudgetLine` gana una propiedad opcional. El clonado (`BudgetCloner`) no debe copiar la base: TC-PLANNING-TEMPLATE-007/-008 siguen en verde. Una línea de template aplicada desde el historial queda `overridden`, así que la propagación la informa como conflicto (comportamiento existente, TC-PLANNING-TEMPLATE-016). Sin consumidores nuevos: el presupuesto de conexiones (D249, 64 de 67) no cambia.

**Riesgos introducidos:** RISK-029 (rendimiento de agregados de 12 meses; benchmark nightly), RISK-025 (planificación abandonada: lo mitiga), RISK-020 (periodos con día de inicio configurable: la ventana usa el calendario de periodos, no meses calendario).

**Invariantes afectadas:** INV-015 (no se modifica el plan de un periodo cerrado), INV-025 (aislamiento por workspace) e INV-029 (auditoría en la misma transacción). Redondeo HALF_EVEN a la escala de la moneda. Ninguna escritura en el ledger.
