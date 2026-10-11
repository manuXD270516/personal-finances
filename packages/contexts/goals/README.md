# @pf/goals — bounded context GOALS

Metas de ahorro (openspec `add-savings-goals`, capability `goals/savings-goals`, FR-GOALS-001..010, Phase 4): metas con objetivo,
fecha opcional y cuentas vinculadas; aportes reales (transferencias a una cuenta vinculada) y reservas (*earmarks*, sin ledger);
retiros, liberaciones y reasignaciones; progreso multi-moneda, aporte requerido, fecha esperada y estado de avance; vigilancia de
sobre-asignación por episodio; plan mensual con aporte recurrente administrado; sugerencias de aporte; hitos y meta alcanzada.
GOALS **no mueve dinero por sí mismo** y no escribe en el ledger: las transferencias las crea Transactions por el puerto
`GoalTransferPort` en la misma unidad de trabajo, y las reservas no generan asientos (docs/09 §6).

Idea central (INV-018): `goals.goal_movement` es **append-only** y es la única fuente del progreso. Cada fila tiene `fund`
(`REAL`|`EARMARK`) y `movement` (`CONTRIBUTION`|`WITHDRAWAL`|`REVERSAL`|`REASSIGN_IN`|`REASSIGN_OUT`), con monto firmado en la
moneda de la cuenta. Nada derivado se persiste: progreso, porcentaje, reservado y estado de avance se calculan en lectura.

Estados de la meta: `ACTIVE`, `PAUSED`, `ACHIEVED`, `CLOSED`, `CANCELLED` (máquina `SavingsGoal`, `REACH` y `REOPEN` son de sistema;
`CLOSE` y `CANCEL` liberan las reservas con movimientos explícitos y terminan el aporte programado). Las metas `CLOSED` y
`CANCELLED` no admiten movimientos (`GOAL_CLOSED`). Una baja del tipo de cambio nunca reabre una meta alcanzada (D188).

Flujo: **crear** (objetivo, tipo, cuentas de naturaleza activo) → **aportar** (`REAL`: transferencia + movimiento en una sola UoW,
o vincular una transferencia existente; `EARMARK`: reserva acotada por el saldo contable de la cuenta) → **seguir** (porcentaje,
requerido por periodo financiero, fecha esperada según el ritmo de los últimos `pacePeriods` periodos terminados, estado lineal con
tolerancia) → **alcanzar** (`GoalReached`, hitos 25/50/75 % derivados por NOTIFY) → **cerrar** (usada) o **cancelar**. Corregir es
siempre un movimiento inverso: anular o revisar la transferencia desde Transactions llega por eventos y genera el `REVERSAL`.

| Capa | Contenido |
|---|---|
| `domain` | AR `SavingsGoal` con la máquina `GOAL_LIFECYCLE` (`CREATE`, `PAUSE`, `RESUME`, `REACH`, `REOPEN`, `CLOSE`, `CANCEL`; `ARCHIVE` es una anotación solo de terminales) y la entidad `GoalMovement` (constructores `contribution`, `withdrawal`, `reversalOf`, `reassignment`; `GoalFunds` = Σ por `(cuenta, fondo)`). Servicios puros: `GoalProgressCalculator` (Σ por moneda y conversión única), `RequiredContributionCalculator`, `ExpectedDateCalculator`, `GoalTrackingEvaluator` (lineal con tolerancia), `EarmarkGuard` (reservado + monto ≤ saldo contable) y el VO `ReservationEpisode`. Sin Nest, Kysely ni módulos de Node. |
| `application` | `GoalsService` (crear, editar, pausar, reanudar, cerrar, cancelar, archivar), `MovementsService` (aportar, vincular transacción, retirar, reasignar, sugerencias), `PlanService` (plan mensual y definición recurrente administrada), `GoalsQueries` (lista, detalle, movimientos, simulación, reservas, sugerencias, recorrido; implementa `GoalReservationsQuery`, `GoalPlansQuery`, `GoalSummaryQuery` y `GoalFlowsQuery`), `MovementRecorder` (inserta el movimiento, evalúa estado y publica el hecho), `ReservationWatch` (episodios de sobre-asignación) y `GoalReactions` (consumidores y job). Dobles en `application/testing`. |
| `infrastructure` | Repositorios Kysely/SQL (`goals.*`) y `PgGoalsUnitOfWork`; `FOR UPDATE` de la meta en cada comando (de las dos metas, en orden de id, al reasignar) y de la fila `account_reservation_state` para serializar reservas sobre la misma cuenta. |
| `interface` | `GoalsModule` + controlador (`/goals*`, tag Goals de la API), con `Idempotency-Key` en creación y movimientos, `If-Match` en edición y transiciones, `GoalsRuntime` y `goalsEventConsumers`. |
| `contracts` | Eventos `goals.SavingsContributionRecorded.v1`, `GoalReached.v1` y `EarmarkExceedsBalance.v1`, consultas públicas `GoalReservationsQuery` (base de Q5, `add-spendable-amount`), `GoalPlansQuery` (aportes planificados del periodo, para Planning y Q5), `GoalSummaryQuery` (Home, Q9) y `GoalFlowsQuery` (aportes netos, Q6), `GOALS_CONSUMERS`, `GOALS_DAILY_JOB`, `GOALS_AUDIT_POLICY` y las secciones de portabilidad (órdenes 772–778: `savings-goals`, `goal-linked-accounts`, `goal-movements`, `goal-plans`, `goal-account-reservation-states`, `goal-recurring-materializations`, `goal-contribution-suggestions`). |

Dependencias permitidas: solo `contracts` de Transactions (`GoalTransferPort.recordTransfer`, `TransactionLinkQuery`), Ledger
(`AccountBalancesQuery`), Accounts (catálogo de cuentas), FX (`FxValuationPort`), Commitments (`RecurringDefinitionPort`:
`createManaged`, `reviseManaged`, `pauseManaged`, `resumeManaged`, `end`), Identity (calendario y moneda base) y Audit, y
`@pf/shared-kernel`/`@pf/platform` (incluido el calendario financiero puro `FinancialPeriodCalendar`). Planning, Reporting y Notify
**no** son dependencias de Goals: Planning lee `GoalPlansQuery` por su puerto `GoalPlanPort` (adapter en `apps/api`) y Reporting y
Notify consumen los contratos públicos y los eventos. Transactions y Commitments **no** importan a Goals: la guarda
`RECURRING_MANAGED_EXTERNALLY` protege la definición que Goals administra (`managedBy = GOAL`) y las acciones sobre sus
ocurrencias siguen permitidas.

Eventos publicados: `goals.SavingsContributionRecorded.v1` (uno por movimiento, también inversos y reasignaciones, con progreso antes
y después), `goals.GoalReached.v1` (`trigger` `MOVEMENT`, `TARGET_CHANGE` o `RATE_CHANGE`) y `goals.EarmarkExceedsBalance.v1` (una
vez por episodio de sobre-asignación de una cuenta). NOTIFY los traduce con `notifications.goal-over-allocated` (OWNER y EDITOR),
`notifications.goal-reached` y `notifications.goal-milestone` (OWNER, EDITOR y VIEWER).

| Consumidor del worker | Evento | Efecto |
|---|---|---|
| `goals.transaction-changes` | `transactions.TransactionVoided`, `TransferRevised`, `TransactionUpdated` | Movimiento inverso del aporte o retiro respaldado; en una transferencia revisada cuya cuenta destino sigue vinculada, aporte nuevo con el monto revisado |
| `goals.balance-watch` | `ledger.JournalEntryPosted` | Compara lo reservado con el saldo contable de las cuentas con postings y abre o cierra el episodio de sobre-asignación |
| `goals.recurring-contributions` | `commitments.RecurringOccurrenceMaterialized` con `managedBy = GOAL` | Registra el aporte real recurrente si la transferencia ya está posteada; si no, deja la espera en `recurring_materialization` |
| `goals.contribution-suggestions` | `transactions.TransferCompleted` | Crea la sugerencia de aporte (descarta las de Goals, las de su propio plan y las ya vinculadas) y completa los aportes recurrentes en espera; expira las sugerencias de transferencias anuladas o revisadas |

Todos con concurrencia 1 (el presupuesto de conexiones del worker pasó a 27 consumidores, `DATABASE_POOL_MAX` 33 en el host y 48 en
desarrollo, docs/11 §2) e idempotentes por inbox (INV-028) y por claves de negocio (`reverses_id` único, índices únicos por
transacción y revisión).

Job `goals.daily-evaluation` (pg-boss, `GOALS_DAILY_CRON`, por omisión `40 * * * *` en UTC u `off`; también corre al arrancar el
worker): reevalúa con "hoy" en la zona de cada workspace las metas con fondos en otra moneda (puede aplicar `REACH` por tipo de
cambio, nunca `REOPEN`) y barre la sobre-asignación de todas las cuentas con reservas como red de seguridad. Concurrencia 1;
repetirlo es inocuo.

Reglas de cálculo que conviene no olvidar: reservado de una cuenta = Σ de los movimientos de las metas `ACTIVE`, `PAUSED` o
`ACHIEVED` (reservas más aportes reales netos que siguen en la cuenta, D180); el límite de reservas usa el saldo **contable**
(D183) y un gasto concurrente que gana la carrera se detecta después como sobre-asignación; el progreso multi-moneda convierte cada
moneda una vez con la tasa vigente y un fondo sin tasa queda en `unconverted[]` (nunca 1:1); el requerido cuenta periodos
financieros del workspace, no meses calendario. Solo las transferencias cuentan como aporte real en Phase 4 (D181).

Esquema de BD: `apps/api/db/migrations/20261013100100_goals_schema.sql` (schema `goals`, 7 tablas con RLS forzada: `savings_goal`,
`goal_linked_account`, `goal_movement` —append-only con `forbid_mutation`—, `goal_plan`, `account_reservation_state`,
`recurring_materialization`, `contribution_suggestion`; registradas en `platform.workspace_scoped_table`),
`20261013100000_commitments_goal_managed.sql` (`GOAL` en el CHECK `managed_by` de Commitments) y `20261013100200_txn_goal_ref_uk.sql`
(índice único por la referencia externa `goals.movement` de las transferencias de metas en Transactions). Decisiones en
`openspec/changes/add-savings-goals/design.md` y en docs/37 (D179–D193).

| Script | Efecto |
|---|---|
| `pnpm test` | Unitarios, propiedades y aplicación con dobles en memoria (`src/**/*.test.ts`) |
| `pnpm test:integration` | Repositorios, RLS, permisos y restricciones contra PostgreSQL 18 (Testcontainers; requiere Docker). Las pruebas de API viven en `apps/api/test/api/goals.api.test.ts` |
