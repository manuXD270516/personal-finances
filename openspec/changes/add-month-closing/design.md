# Diseño

## Contexto

Bounded context **PLANNING** (`@pf/planning`, docs/05 §2.6): este change completa el agregado `FinancialPeriod` de `add-financial-periods` con las transiciones `CLOSE`/`REOPEN` y agrega el proceso de cierre (`MonthCloser` en docs/04 §3.6). Integra de forma **síncrona en la misma transacción** con LEDGER (`LedgerPeriodLockPort`, docs/06 fila 14, ARCHITECTURE §7) y por **queries síncronas** con TRANSACTIONS (pendientes, duplicados, sin categoría, reconciliación de pf-p2c), REPORTING (flujos del periodo y patrimonio a una fecha), FX (tasas de valoración) y, si existe, PLANNING/budgets de pf-p2b (presupuesto vs real). Fuentes: docs/01 FR-PLANNING-003..007, FR-TRANSACTIONS-030; docs/02 NFR-DATA-006/007, NFR-USAB-004; docs/04 §3.6/§4.2; docs/08 §5.3 (`period_lock`), §5.6 (`month_closing`); docs/09 §10, INV-015; docs/10 §10 (roles: cerrar OWNER/EDITOR, reabrir OWNER); docs/11 §3.3 (`MonthClosed`, `PeriodReopened`); docs/14 §2–§3; docs/24 §5.2 (criterio de salida); docs/26 RISK-020; docs/31 D10, D15, D29, D37, D47, D49, D53; ADR-0004, ADR-0008, ADR-0023, ADR-0026 y **ADR-0028 (propuesto en este change)**. Motivación: proposal.md.

Capas afectadas:

| Capa | Cambio |
|---|---|
| planning/domain | AR `FinancialPeriod`: comandos `close(checklist, ack, today, previous)` y `reopen(reason, next)`; AR `ClosingPolicy {workspaceId, severities: Record<ChecklistItemKind, BLOCKING\|WARNING>, version}`; VO `CloseChecklist`, `ChecklistItem {kind, count, amounts: Money[], details, severity, availability}`; VO `CloseSnapshotContent` (inmutable); DS `CloseChecklistEvaluator` (puro: datos → ítems + veredicto), `CloseSnapshotBuilder` (puro: saldos, flujos, valoración → contenido con redondeo HALF_EVEN solo al materializar), `SnapshotDiff`. |
| planning/application | `GetCloseChecklist`, `CloseMonth`, `ReopenPeriod`, `GetClosingPolicy`, `UpdateClosingPolicy`, `ListCloseSnapshots`, `GetCloseSnapshot`, `CompareCloseSnapshots`, `GetCloseReport`, `ExportCloseReport`. Puertos de salida: `FinancialPeriodRepository` (de `add-financial-periods`), `ClosingPolicyRepository`, `CloseSnapshotRepository` (append-only), `PeriodReopeningRepository` (append-only), `LedgerPeriodLockPort`, `LedgerBalanceQuery` (`BalanceQuery` existente), `TransactionsClosingQuery`, `ReconciliationStatusQuery` (pf-p2c), `PeriodFlowsQuery` y `NetWorthQuery` (REPORTING), `BudgetVsActualQuery` (pf-p2b, opcional), `AuditPort`, `LifecycleTransitionPort`, `OutboxPort`, `Clock`, `ReportRenderer` (CSV/PDF). |
| ledger | `LedgerPeriodLockPort.lockPeriod` acepta `periodStart`/`periodEnd` y `openStart` (primer periodo); toma el candado consultivo **exclusivo** del workspace; `PeriodLockRepository.isLocked(workspaceId, date)` por rango; nueva `firstOpenDateOnOrAfter(workspaceId, date)`; migración de `ledger.period_lock` y de `ledger.assert_period_open()` (ADR-0028). |
| transactions | Queries públicas `TransactionsClosingQuery` (`countPendingInRange`, `countOpenDuplicatesInRange`, `countUncategorizedInRange`, con montos por moneda) y la implementación de `VoidRequest.correctInCurrentPeriod` (ya en el contrato desde Phase 1, sin implementación) usando `firstOpenDateOnOrAfter`. |
| reporting | `PeriodFlowsQuery.getFlows({dateFrom, dateTo, reportingCurrency})` (las mismas cifras que `GET /reports/summary` con `dateFrom/dateTo`, D15) y `NetWorthQuery.getNetWorth({asOf, reportingCurrency})` (patrimonio a una fecha con el selector de tasa vigente y la ventana del setting de REPORTING, D53). Ambas aceptan la transacción del llamador. |
| interface / apps/web | Endpoints de cierre bajo `periods`; pantallas "Cierre de mes" (checklist, confirmación con advertencias, resultado), "Reporte de cierre" (versión, MoM, comparación, exportar) y "Reabrir" (OWNER, motivo); recorrido del periodo con el componente existente de `add-lifecycle-timeline`. |

## Objetivos / No objetivos

**Objetivos:**
- INV-015 exacta para periodos financieros (ADR-0028) con doble barrera y sin carrera cierre ↔ posteo.
- Snapshot inmutable (NFR-DATA-006), versionado, reproducible y verificable contra el ledger (INV-022).
- Cumplir el criterio de salida de Phase 2: cierre real con todas las cuentas conciliadas a diferencia 0; reabrir/re-cerrar sin alterar el snapshot anterior.

**No objetivos:**
- Sesiones de reconciliación, ajustes de reconciliación y `TransactionCleared` (pf-p2c).
- Contenido y cálculo del plan mensual y del presupuesto vs real (pf-p2b); aquí solo se congela lo que su query devuelve.
- Reapertura en cascada, cierre automático, cierre anual/fiscal, ajustes automáticos de cierre.

## Decisiones

1. **Checklist = consulta pura + evaluador de dominio.** `GetCloseChecklist` reúne datos por queries (sin efectos ni auditoría) y `CloseChecklistEvaluator` decide. Ítems (`ChecklistItemKind`): `PENDING_TRANSACTIONS` (transacciones `PENDING` con fecha de negocio en el rango), `UNRECONCILED_ACCOUNTS` (decisión 2), `UNRESOLVED_DUPLICATES` (candidatos `OPEN` de `transactions/duplicate-detection` con al menos una transacción en el rango), `UNCATEGORIZED` (porciones posteadas del rango con categoría de sistema `UNCATEGORIZED` o `UNCATEGORIZED_INCOME`, D9), `UNRESOLVED_RECURRING` (`availability: NOT_AVAILABLE` hasta Phase 3; nunca bloquea mientras no esté disponible). Montos por moneda sin convertir.

2. **Cuenta conciliada para el cierre** (contrato con pf-p2c, `ReconciliationStatusQuery.getCoverage({accountIds, through})`): una cuenta está conciliada al fin `E` del periodo si su última conciliación **finalizada** tiene `difference = 0` y `statementDate ≥ E`, y `unreconciledPostedCountThrough(E) = 0` (ninguna transacción `posted`/`cleared` de esa cuenta con fecha ≤ `E` sin conciliar). Cuentas exigidas: no archivadas con saldo contable ≠ 0 al `E` **o** con postings en el rango. Las cuentas `CLOSED` con saldo 0 y sin movimientos del rango quedan exentas. Si `ReconciliationStatusQuery` no está disponible (pf-p2c no aplicado), el ítem se informa `NOT_AVAILABLE` y **bloquea** si su severidad es `BLOCKING` (no se puede afirmar la conciliación) — ver P-A9.

3. **Política de cierre** `planning.closing_policy` (una fila por workspace, creada perezosamente; ausencia = defaults): `PENDING_TRANSACTIONS = BLOCKING`, `UNRECONCILED_ACCOUNTS = BLOCKING`, resto `WARNING` (docs/01 pregunta 5: se recomienda bloquear, P-A8). `PUT …/planning/closing-policy` solo OWNER, `If-Match`, auditado con `before/after`.

4. **Orden y "terminado".** `close` exige: estado `ACTIVE|REOPENED` (si no, `INVALID_STATUS_TRANSITION`), `periodEnd < Clock.today(workspace.timeZone)` (si no, `PERIOD_NOT_ENDED`; RISK-020) y el periodo anterior inexistente o `CLOSED` (si no, `PERIOD_PREVIOUS_NOT_CLOSED`). `reopen` exige `CLOSED`, rol OWNER, motivo 1–500, y el siguiente inexistente o no `CLOSED` (si no, `PERIOD_NEXT_CLOSED`; sin cascada — docs/04 pregunta 3, P-A11). Prioridad de errores: autorización → `If-Match` → estado → orden → terminado → checklist.

5. **Secuencia atómica de `CloseMonth`** (una Unit of Work, `READ COMMITTED`):
   1. `SELECT … FOR UPDATE` del periodo + `If-Match` (la fila bloqueada también serializa con el `FOR SHARE` del guard de planificación de pf-p2b).
   2. Guardas de la decisión 4.
   3. `LedgerPeriodLockPort.lockPeriod({periodStart, periodEnd, label, periodId, openStart})`: toma `pg_advisory_xact_lock` **exclusivo** con la misma clave por workspace que cada `PostJournalEntry`/reversa toma en modo **compartido** (registro de hardening de `add-ledger-core`, punto 2). Así espera a que terminen los posteos en vuelo y, al insertar el lock, ningún posteo posterior del rango puede entrar (trigger `PF004` en cuanto confirma; antes de confirmar, los posteos nuevos esperan el candado). Esto cierra la carrera del scenario "Cierre concurrente con un posteo".
   4. Evaluación del checklist **dentro** de la transacción (después del candado: los datos del ledger están quietos). Bloqueante → `MONTH_CLOSING_BLOCKED` con `blockingItems[]` en el problem; advertencias sin `acknowledgeWarnings: true` → `MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED` con `warningItems[]`. Ambos hacen *rollback* (el lock desaparece).
   5. `CloseSnapshotBuilder` con saldos `BalanceQuery` a `periodEnd`, flujos `PeriodFlowsQuery` del rango, patrimonio `NetWorthQuery` a `periodEnd` (tasas `PARALLEL` por preferencia D29/D48, ventana del setting de REPORTING D53, `complete` + `unconverted[]` D15), evidencia de conciliación por cuenta (pf-p2c), presupuesto vs real (pf-p2b, `null` si no hay plan o el change no existe) y metas (`null` hasta Phase 4).
   6. INSERT `close_snapshot` (+ `close_snapshot_balance`), UPDATE del periodo (`status = CLOSED`, `close_count + 1`, `latest_close_no`, `version + 1`), `AuditPort` (`planning.period.closed`, con advertencias reconocidas), transición `CLOSE` del recorrido, outbox `planning.MonthClosed.v1`.
   Cualquier excepción ⇒ *rollback* completo (TC-PLANNING-CLOSE-001 con falla inyectada).

6. **Primer periodo cerrado protege lo anterior.** Si el periodo es el primero del workspace (no existe periodo anterior), el lock se escribe con `period_start = '-infinity'` (`openStart = true`): un asiento con fecha anterior al primer periodo se rechaza con `PF004`, y `EnsurePeriods` deja de crear periodos hacia atrás (ya no hay cobertura retroactiva cuando existe un cierre). Alternativa descartada: permitir asientos anteriores al primer periodo cerrado — alterarían el saldo de apertura del primer snapshot sin que nada lo detecte (violación silenciosa de INV-015 en la práctica).

7. **Bloqueo por rango (ADR-0028).** `ledger.period_lock` agrega `period_start date`, `period_end date` (NOT NULL tras el relleno), exclusión gist `(workspace_id WITH =, daterange(period_start, period_end, '[]') WITH &&)`; la PK `(workspace_id, year_month)` se mantiene con `year_month` = etiqueta del periodo. `ledger.assert_period_open()` pasa a `EXISTS (… WHERE workspace_id = NEW.workspace_id AND NEW.entry_date BETWEEN period_start AND period_end)` (`'-infinity'::date` funciona con `BETWEEN`). `LedgerService.assertPeriodOpen({date})` (usado por recategorización, D49) y `isLocked` pasan a recibir la fecha. Compatibilidad: `lockPeriod` sin rango ⇒ mes calendario de `yearMonth` (comportamiento de Phase 1; TC-LEDGER-PERIOD-001/002 sin cambios).

8. **Qué rechaza un periodo cerrado** (requirement "Bloqueo del ledger en periodos cerrados"): todo lo que postea, revierte o revisa (barrera del ledger), la recategorización (D49, ya implementada vía `assertPeriodOpen`), y los cambios de estado de conciliación (`reconcile`/`unreconcile`/`clear`/`unclear`) de transacciones con fecha en el periodo — esto último lo implementa pf-p2c llamando a `assertPeriodOpen` (dependencia explícita). La anulación con `correctInCurrentPeriod: true` fecha la reversa en `firstOpenDateOnOrAfter(fechaOriginal)` (= día siguiente al fin del último periodo cerrado contiguo) y la implementa este change en TRANSACTIONS. Ediciones descriptivas (notas, adjuntos) y transacciones `pending`: ver P-A12 y P-A13.

9. **Snapshot inmutable y versionado.** `planning.close_snapshot` (cabecera + contenido) y `planning.close_snapshot_balance` (una fila por cuenta, `NUMERIC(38,18)`) son **WS-RO**: `pf_app` solo `SELECT, INSERT`, trigger `platform.forbid_mutation()` (`PF003`, INV-007/NFR-DATA-006). Versión `close_no` = 1, 2, … por periodo (`UNIQUE (period_id, close_no)`), `previous_snapshot_id` enlaza la versión anterior. El contenido no numérico (checklist, tasas, flujos por moneda, presupuesto) va en `jsonb` con montos **solo como `{amount: "decimal", currency}`** (nunca números JSON; validado contra el schema interno `close-snapshot-content.v1` en el repositorio) y `content_sha256` del contenido canónico para detectar corrupción en el verificador. Redondeo: los saldos y flujos son exactos; solo se materializan con HALF_EVEN a la escala de la moneda el patrimonio consolidado y los consolidados en moneda base (una sola cuantización, INV-020); la tasa de ahorro con un decimal (como `reporting/dashboard`).

10. **Reapertura** (`ReopenPeriod`): `SELECT … FOR UPDATE`, guardas, `LedgerPeriodLockPort.unlockPeriod({label, reason})` (DELETE del lock, auditado por LEDGER), INSERT `planning.period_reopening` (WS-RO: `reopen_no`, `reason`, `reopened_by`, `reopened_at`, `closed_snapshot_id`), UPDATE del periodo (`REOPENED`, `reopen_count + 1`), auditoría `planning.period.reopened`, transición `REOPEN`, outbox `planning.PeriodReopened.v1`. Ningún snapshot se toca. El re-cierre es el mismo `CloseMonth` (crea `close_no + 1`).

11. **Reporte, comparación y exportación.** `GetCloseReport(periodId, closeNo?)` = snapshot (vigente = mayor `close_no`) + metadatos (quién/cuándo, versiones) + **MoM** contra el snapshot vigente del periodo inmediatamente anterior (variación absoluta y porcentual con un decimal; si el anterior no tiene snapshot, `comparison: null` con motivo `NO_PREVIOUS_SNAPSHOT`). Nota: el MoM usa el snapshot vigente del periodo anterior en el momento de la consulta (el reporte no se congela: el snapshot sí). `CompareCloseSnapshots(periodId, from, to)` calcula diferencias exactas por cuenta y por total. `ExportCloseReport(format: csv|pdf)` síncrono, reutilizando el renderizador CSV/PDF de `add-lifecycle-timeline` (D52): CSV RFC 4180 UTF-8 con BOM, columnas `section, account, currency, amount` (montos como texto decimal a la escala de la moneda) y cabecera con versión y fecha de cierre; PDF con KPIs, saldos y aviso de versiones.

12. **Eventos** (ADR-0008, outbox en la misma transacción): `planning.MonthClosed.v1` — payload `{workspaceId, periodId, label, periodStart, periodEnd, closeNo, snapshotId, previousSnapshotId|null, closedAt, closedBy, baseCurrency, totalsByCurrency: [{currency, income: Money, expense: Money}], consolidated: {income, expense, savings: Money, savingsRate: string|null}, balances: [{accountId, balance: Money}], netWorth: {amount: Money, complete: boolean}}`; idempotencia natural `(periodId, closeNo)`. `planning.PeriodReopened.v1` — `{workspaceId, periodId, label, periodStart, periodEnd, reopenNo, reason, reopenedBy, reopenedAt, closedSnapshotId}`; idempotencia `(periodId, reopenNo)`; PII baja (`reason` texto libre). Consumidores: REPORTING (marca/invalida la caché de periodos cerrados, docs/14 §11), pf-p2b NOTIFY (opcional: "mes cerrado"), pf-p2c evolución del patrimonio (opcional: punto mensual oficial), FORECAST (Phase 8).

13. **Autorización** (docs/10 §10): checklist, snapshots, reporte, comparación, exportación y recorrido: `VIEWER`; cerrar: `EDITOR`; reabrir y cambiar la política: `OWNER` (docs/10 pregunta 8 — P-A10).

14. **Verificador** (extiende `ledger.daily-maintenance` o job propio `planning.verify-closings`): para cada periodo `CLOSED`, Σ postings por cuenta a `periodEnd` = saldos de su snapshot vigente y `content_sha256` coincide; existe exactamente un lock por periodo `CLOSED` y ninguno por periodo no cerrado. Violación ⇒ log `error` con `alert=planning.closing_violation`, métrica `planning_closing_violations_total{check}` (NFR-DATA-008).

15. **Recorrido** (D37): `aggregate_type = 'FINANCIAL_PERIOD'`, máquina `FINANCIAL_PERIOD_LIFECYCLE` completa; `GET …/periods/{id}/lifecycle` reutiliza el endpoint genérico de `add-lifecycle-timeline` (CSV/PDF incluidos). Las transiciones `CLOSE` referencian `snapshotId`/`closeNo`; `REOPEN` lleva el motivo.

## Contratos

Cambios EXACTOS requeridos (este change no edita `contracts/`; los consolida el lead). Todas las operaciones con `x-openspec-capability: [planning/month-closing]` salvo indicación, seguridad estándar y parámetros `workspaceId`/`periodId` en path.

**`contracts/openapi/finance-api.v1.yaml`**

1. Operaciones nuevas:
   - `GET …/periods/{periodId}/close-checklist` — `getCloseChecklist`, `VIEWER`; `200` → `CloseChecklist`; `404`.
   - `POST …/periods/{periodId}/close` — `closePeriod`, `EDITOR`; `If-Match` obligatorio; `Idempotency-Key` obligatorio (comando financiero, INV-027); body `ClosePeriodRequest`; `200` → `FinancialPeriod` (con `latestCloseNo`) y cabecera `Location` del snapshot; `409` (`MONTH_CLOSING_BLOCKED` con extensión `blockingItems: CloseChecklistItem[]`, `MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED` con `warningItems`, `PERIOD_NOT_ENDED`, `PERIOD_PREVIOUS_NOT_CLOSED`, `INVALID_STATUS_TRANSITION`), `412`, `428`, `403`, `404`.
   - `POST …/periods/{periodId}/reopen` — `reopenPeriod`, `OWNER`; `If-Match` e `Idempotency-Key` obligatorios; body `ReopenPeriodRequest`; `200` → `FinancialPeriod`; `409` (`PERIOD_NEXT_CLOSED`, `INVALID_STATUS_TRANSITION`), `400`, `412`, `428`, `403`, `404`.
   - `GET …/periods/{periodId}/close-snapshots` — `listCloseSnapshots`, `VIEWER`; `200` → `{ items: CloseSnapshotSummary[] }`.
   - `GET …/periods/{periodId}/close-snapshots/{closeNo}` — `getCloseSnapshot`, `VIEWER`; `200` → `CloseSnapshot`; `404`.
   - `GET …/periods/{periodId}/close-snapshots/compare?from=&to=` — `compareCloseSnapshots`, `VIEWER`; `200` → `CloseSnapshotDiff`; `404`, `400`.
   - `GET …/periods/{periodId}/close-report?closeNo=` — `getCloseReport`, `VIEWER`; `200` → `CloseReport`; `404 REFERENCE_NOT_FOUND` si nunca se cerró.
   - `GET …/periods/{periodId}/close-report/export?format=csv|pdf&closeNo=` — `exportCloseReport`, `VIEWER`; `200` `text/csv` o `application/pdf` con `Content-Disposition`; `404`, `400`.
   - `GET /workspaces/{workspaceId}/planning/closing-policy` — `getClosingPolicy`, `VIEWER`; `200` → `ClosingPolicy` con `ETag`.
   - `PUT /workspaces/{workspaceId}/planning/closing-policy` — `updateClosingPolicy`, `OWNER`; `If-Match`; body `ClosingPolicyUpdate`; `200` → `ClosingPolicy`; `403`, `412`, `428`, `400`.
   - `GET …/periods/{periodId}/lifecycle` (y su exportación) — reutiliza el patrón de `add-lifecycle-timeline` con `x-openspec-capability: [audit/lifecycle-timeline]`.
2. Schemas nuevos:
   - `ChecklistItemKind`: `enum [PENDING_TRANSACTIONS, UNRECONCILED_ACCOUNTS, UNRESOLVED_DUPLICATES, UNCATEGORIZED, UNRESOLVED_RECURRING]`; `ChecklistSeverity`: `enum [BLOCKING, WARNING]`.
   - `CloseChecklistItem`: `{ kind, severity, availability: enum [AVAILABLE, NOT_AVAILABLE], count: integer, amounts: Money[], details: CloseChecklistDetail[] }`; `CloseChecklistDetail`: `{ refType: enum [TRANSACTION, ACCOUNT, DUPLICATE_CANDIDATE, SPLIT], refId: Uuid, label: string, date: LocalDate|null, amount: Money|null }` (máx. 50 por ítem, con `truncated: boolean` en el ítem).
   - `CloseChecklist`: `{ periodId, label, periodStart, periodEnd, evaluatedAt: Instant, canClose: boolean, requiresAcknowledgement: boolean, items: CloseChecklistItem[] }`.
   - `ClosePeriodRequest`: `{ acknowledgeWarnings: boolean (default false), note: string (0..500, opcional) }`.
   - `ReopenPeriodRequest`: `{ reason: string (minLength 1, maxLength 500) }` (required).
   - `CloseSnapshotSummary`: `{ snapshotId, closeNo, closedAt, closedBy, previousSnapshotId|null, isCurrent: boolean }`.
   - `CloseSnapshot`: `CloseSnapshotSummary` + `{ periodId, label, periodStart, periodEnd, baseCurrency, balances: [{accountId, accountName, currency, balance: Money, presented: Money, reconciliation: {reconciliationId, statementDate, statementBalance: Money}|null}], flows: {byCurrency: [{currency, income: Money, expense: Money, savings: Money}], consolidated: {income: Money, expense: Money, savings: Money, savingsRate: string|null}}, netWorth: {amount: Money, complete: boolean, unconverted: Money[], rates: ValuationRateUsed[]}, budgetVsActual: {lines: [{categoryId, categoryName, planned: Money, actual: Money}]}|null, goalContributions: {items: [...]}|null, checklist: CloseChecklistItem[], acknowledgedWarnings: {items: ChecklistItemKind[], by: Uuid, at: Instant}|null }`. `ValuationRateUsed` reutiliza el schema de tasa usada de `reporting/net-worth` si existe (par, tipo, valor, vigencia, fuente con atribución, id de la tasa).
   - `CloseSnapshotDiff`: `{ from: integer, to: integer, balances: [{accountId, currency, delta: Money}], flows: {...deltas}, netWorth: {delta: Money} }`.
   - `CloseReport`: `{ snapshot: CloseSnapshot, versions: CloseSnapshotSummary[], comparison: {previousPeriodId, previousLabel, previousCloseNo, deltas: [{kpi: enum [INCOME, EXPENSE, SAVINGS, SAVINGS_RATE, NET_WORTH], absolute: Money|string, percentage: string|null}]}|null, comparisonUnavailableReason: enum [NO_PREVIOUS_PERIOD, NO_PREVIOUS_SNAPSHOT]|null }`.
   - `ClosingPolicy`: `{ severities: {PENDING_TRANSACTIONS: ChecklistSeverity, …5 claves}, version: integer, updatedAt: Instant|null, updatedBy: Uuid|null }`; `ClosingPolicyUpdate`: `{ severities }` (las 5 claves required).
3. `ErrorCode` — agregar: `PERIOD_NOT_ENDED` (409), `PERIOD_PREVIOUS_NOT_CLOSED` (409), `PERIOD_NEXT_CLOSED` (409), `MONTH_CLOSING_BLOCKED` (409), `MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED` (409). docs/10 §9.1 listaba para planning `PERIOD_OVERLAP` y `MONTH_CLOSING_IN_PROGRESS`: **no se usan** (los rangos los calcula el sistema; el cierre es síncrono y serializado por `FOR UPDATE` + `If-Match`): propuesta de retirarlos de docs/10.
4. `VoidRequest.correctInCurrentPeriod`: sin cambio de schema; la descripción precisa "fecha la reversa en el primer día abierto posterior a la fecha original".

**`contracts/events/planning/`**

- `MonthClosed.v1.schema.json` y `PeriodReopened.v1.schema.json` con los payloads de la decisión 12 (`additionalProperties: false`, `Money` como string decimal). Agregar PLANNING como productor en `contracts/events/README.md` y docs/11 §3.3 (actualizar el payload resumido).

**Contratos internos entre contextos (TypeScript, `contracts` de cada paquete):**

- `@pf/ledger/contracts` `LedgerPeriodLockPort.lockPeriod({workspaceId, yearMonth, periodId?, periodStart?, periodEnd?, openStart?})` (campos nuevos opcionales), `firstOpenDateOnOrAfter({workspaceId, date}) → LocalDate`.
- `@pf/transactions/contracts` `TransactionsClosingQuery` (este change) y `ReconciliationStatusQuery.getCoverage({workspaceId, accountIds, through}) → [{accountId, lastCompleted: {reconciliationId, statementDate, statementBalance: Money, difference: Money, completedAt} | null, unreconciledPostedCountThrough: number}]` (**pf-p2c**).
- `@pf/reporting/contracts` `PeriodFlowsQuery`, `NetWorthQuery` (este change, extendiendo las consultas de Phase 1 con `dateFrom/dateTo` y `asOf`).
- `@pf/planning/contracts` `BudgetVsActualQuery.getForPeriod({workspaceId, periodId}) → {lines: [{categoryId, categoryName, planned: Money, actual: Money}], currency} | null` (**pf-p2b**).

## Modelo de datos

| Tabla | Columnas clave | Unique / Check | RLS / grants |
|---|---|---|---|
| `planning.closing_policy` | `workspace_id` PK, `pending_transactions`, `unreconciled_accounts`, `unresolved_duplicates`, `uncategorized`, `unresolved_recurring` (`text` `BLOCKING\|WARNING`), `version`, `updated_at`, `updated_by` | CHECK de los valores | WS; `SELECT, INSERT, UPDATE` |
| `planning.close_snapshot` | `id` PK, `workspace_id`, `period_id` FK, `close_no`, `label`, `period_start`, `period_end`, `start_day`, `base_currency`, `closed_at`, `closed_by`, `previous_snapshot_id`, `checklist jsonb`, `acknowledged_warnings jsonb`, `flows jsonb`, `net_worth jsonb`, `budget_vs_actual jsonb NULL`, `goal_contributions jsonb NULL`, `content_schema_version`, `content_sha256` | `UNIQUE (period_id, close_no)`, `UNIQUE (workspace_id, id)`, `CHECK (close_no >= 1)` | **WS-RO**; `SELECT, INSERT`; `forbid_mutation` (PF003) |
| `planning.close_snapshot_balance` | PK `(snapshot_id, account_id)`, `workspace_id`, `ledger_account_id`, `currency`, `balance NUMERIC(38,18)`, `presented NUMERIC(38,18)`, `reconciliation_id NULL`, `statement_date NULL`, `statement_balance NUMERIC(38,18) NULL` | FK compuesta `(workspace_id, snapshot_id)` | **WS-RO**; `forbid_mutation` |
| `planning.period_reopening` | `id` PK, `workspace_id`, `period_id`, `reopen_no`, `reason`, `reopened_by`, `reopened_at`, `closed_snapshot_id` | `UNIQUE (period_id, reopen_no)`, `CHECK (length(reason) BETWEEN 1 AND 500)` | **WS-RO**; `forbid_mutation` |
| `ledger.period_lock` | + `period_start date`, `period_end date` | exclusión gist por rango | sin cambios (WS; `SELECT, INSERT, DELETE`) |

Se reemplaza el diseño de docs/08 §5.6 `planning.month_closing` (intentos con estado `IN_PROGRESS/COMPLETED/REOPENED` mutable) por snapshots y reaperturas **append-only**: el cierre es síncrono (no hay intento "en progreso") y un snapshot nunca cambia de estado. docs/08 se actualiza (tarea 8.1).

## Dependencias con otros changes de Phase 2

- **Requiere `add-financial-periods`** (este bloque pf-p2a): AR `FinancialPeriod`, máquina, `PeriodQuery`, guard de planificación.
- **Requiere pf-p2c — reconciliación completa** (`transactions/reconciliation`, sesiones con diferencia 0): (a) `ReconciliationStatusQuery.getCoverage` con la semántica de la decisión 2; (b) que `reconcile/unreconcile/clear/unclear` de transacciones con fecha en un periodo cerrado se rechacen con `PERIOD_CLOSED` vía `LedgerService.assertPeriodOpen` (requirement "Bloqueo del ledger en periodos cerrados"); (c) que la conciliación exponga `statementDate` y `statementBalance` para la evidencia del snapshot. Sin (a) no se cumple el criterio de salida de Phase 2. `transactions.TransactionCleared` (D47) no se consume aquí.
- **Opcional pf-p2b — presupuestos:** `BudgetVsActualQuery.getForPeriod` para el bloque de presupuesto del snapshot (si no existe, `budgetVsActual: null`); pf-p2b debe usar `PlanningEditGuard` (de `add-financial-periods`) para que el plan de un periodo cerrado sea de solo lectura. NOTIFY de pf-p2b puede consumir `planning.MonthClosed.v1` (no requerido).
- **Opcional pf-p2c — evolución del patrimonio y vista global de auditoría:** pueden consumir `planning.MonthClosed.v1` (punto mensual oficial del patrimonio) y mostrar `planning.period.closed/reopened` en la vista global de auditoría; ningún cambio requerido de su parte.
- **pf-p2c — export de workspace:** debe incluir `planning.financial_period`, `planning.closing_policy`, `planning.close_snapshot`, `planning.close_snapshot_balance`, `planning.period_reopening` y `ledger.period_lock`; en el *round-trip* export→import los snapshots se importan tal cual (no se recalculan) y los locks se restauran después de importar los asientos (si no, el import de asientos de periodos cerrados fallaría con `PF004`).
- **ADR-0026 (demo):** la purga del workspace demo debe incluir las tablas nuevas (append-only con `forbid_mutation`: requiere el mismo *amend* acotado a workspaces demo).

## Riesgos / Trade-offs

- [Carrera cierre ↔ posteo] → candado consultivo exclusivo/compartido por workspace + trigger `PF004`; test de concurrencia TC-PLANNING-LOCK-002 con dos conexiones reales.
- [Carrera cierre ↔ creación de `pending` o cambio de conciliación] → no toman el candado del ledger; la ventana es de milisegundos y el verificador lo detecta; P-A12 propone rechazar `pending` en periodos cerrados con `assertPeriodOpen`.
- [Cierre lento con muchos datos] → el snapshot lee saldos con el índice `INCLUDE (amount)` y snapshots de saldo; objetivo p95 ≤ 5 s con el dataset `large` (medición informativa en el job nightly `perf`); el candado exclusivo bloquea posteos del workspace durante el cierre (aceptable: operación mensual de un usuario).
- [RISK-020: "terminado" calculado en UTC] → `Clock.today(tz)` y tests con TZ forzada (TC-PLANNING-CLOSE-005).
- [Dependencia de pf-p2c] → el ítem `UNRECONCILED_ACCOUNTS` queda `NOT_AVAILABLE` y bloquea por defecto: el cierre sin pf-p2c solo es posible si el OWNER baja ese ítem a advertencia (P-A9).
- [Snapshot con tasas resueltas al momento del cierre] → una tasa manual registrada después para esa fecha no cambia el snapshot (es el objetivo); el re-cierre sí la tomará.
- [Trade-off: `jsonb` para el contenido no tabular] → flexibilidad de versiones del contenido a cambio de validación por schema interno y hash; los saldos, que el verificador compara, van en columnas `NUMERIC`.

## Plan de migración

1. *Expand* (migración `…_ledger_period_lock_range.sql`): `ALTER TABLE ledger.period_lock ADD COLUMN period_start date, ADD COLUMN period_end date`; relleno `UPDATE … SET period_start = to_date(year_month || '-01', 'YYYY-MM-DD'), period_end = (to_date(...) + interval '1 month - 1 day')::date` (solo filas de tests/dev; no hay productivas); `CREATE OR REPLACE FUNCTION ledger.assert_period_open()` por rango; exclusión gist.
2. *Contract* (misma release, tras el relleno): `SET NOT NULL` en ambas columnas. Rollback local con `down`; en entornos con datos, *roll-forward*.
3. *Expand* (migración `…_planning_month_closing.sql`): `planning.closing_policy`, `planning.close_snapshot`, `planning.close_snapshot_balance`, `planning.period_reopening`, triggers `platform.forbid_mutation()` en las tres WS-RO, RLS `ENABLE/FORCE`, grants (sin `UPDATE/DELETE` en WS-RO).
4. Actualizar la función de purga demo (ADR-0026) para incluir las tablas nuevas.
Tests: migraciones sobre PG vacío, catálogo RLS, grants por rol y `PF003`/`PF004` con el rol `pf_app` (Testcontainers).

## Preguntas abiertas

Numeración continua con `add-financial-periods` (P-A1..P-A6) para la consolidación del lead. Cada una con recomendación.

- **P-A7. ADR-0028: bloqueo del ledger por el rango del periodo financiero (enmienda D10).** *Recomendación:* aceptar. Sin él, un workspace con día de inicio ≠ 1 no puede cerrar correctamente (o hay que prohibir el cierre con día ≠ 1 — Opción 2 del ADR).
- **P-A8. ¿Las cuentas sin conciliar bloquean o solo advierten? (docs/01 pregunta 5).** *Recomendación:* bloqueante por defecto (lo exige el criterio de salida) y configurable por el OWNER; igual para transacciones `pending`.
- **P-A9. Orden con pf-p2c.** Si la reconciliación completa de pf-p2c no está aplicada, el ítem de cuentas sin conciliar es `NOT_AVAILABLE`. *Recomendación:* aplicar `add-month-closing` después del change de reconciliación de pf-p2c; si se aplica antes, el ítem bloquea (por defecto) y el OWNER puede bajarlo a advertencia para cierres de prueba.
- **P-A10. Reapertura por EDITOR (docs/10 pregunta 8).** *Recomendación:* solo OWNER (especificado); el EDITOR cierra.
- **P-A11. Reapertura en cascada (docs/04 pregunta 3).** *Recomendación:* sin cascada; se reabre en orden inverso uno a uno (`PERIOD_NEXT_CLOSED`), lo que hace explícito cada snapshot afectado.
- **P-A12. Transacciones `pending` con fecha en un periodo cerrado.** No tocan el ledger, pero nunca podrían postearse. *Recomendación:* rechazar crear o editar `pending` con fecha en periodo cerrado con `PERIOD_CLOSED` (vía `assertPeriodOpen`), como nuevo requirement de `transactions/transaction-recording` en este change o en pf-p2c.
- **P-A13. Ediciones no financieras en periodos cerrados.** D49 rechaza recategorizar. ¿Y tags, contraparte, notas, adjuntos, medio de pago? *Recomendación:* rechazar también tags y contraparte (alimentan reportes y presupuestos por tag); permitir notas, descripción, adjuntos y medio de pago (no afectan cifras). Requiere ampliar el alcance de D49.
- **P-A14. Cerrar antes del fin del periodo.** *Recomendación:* no permitirlo (`PERIOD_NOT_ENDED`), aunque sea el último día por la noche: el día aún puede recibir movimientos.
- **P-A15. Cuentas exentas de conciliación (efectivo, cuentas de inversión manuales).** *Recomendación:* sin exenciones por tipo en Phase 2 (el efectivo se concilia con un arqueo); si molesta, una marca por cuenta "excluir del checklist de cierre" en un change posterior.
- **P-A16. Definición de "transacción sin categoría".** *Recomendación:* porciones posteadas con las categorías de sistema `UNCATEGORIZED`/`UNCATEGORIZED_INCOME` (D9); las transferencias y conversiones no cuentan.
- **P-A17. Valoración del patrimonio en el snapshot.** *Recomendación:* misma política que `reporting/net-worth` (tipo `PARALLEL` por preferencia del par, D29/D48, ventana del setting de REPORTING, D53) a la fecha de fin del periodo, congelada en el snapshot con cada tasa usada; si falta una tasa, snapshot `complete: false` con montos sin convertir (D15), sin bloquear el cierre (¿o debería advertir? propuesta: advertencia informativa, no ítem del checklist).
