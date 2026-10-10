# @pf/commitments — bounded context COMMITMENTS

Motor de recurrencia (openspec `add-recurrence-engine`; capability `commitments/recurrence-engine`): definiciones
recurrentes de ingreso, gasto y transferencia, cadencias y RRULE evaluadas en la zona del workspace, generación idempotente
de ocurrencias (INV-013), modos de materialización, acciones sobre ocurrencias y definiciones (versionado "esta y las
siguientes") y el total comprometido del periodo financiero (Q4) con la lista de próximos pagos (Q8). El matching
automático (`add-commitment-matching`) y las suscripciones (`add-subscriptions`) se apoyan en este motor.

| Capa | Contenido |
|---|---|
| `domain` | AR `RecurringDefinition` (cabecera + versiones inmutables `DefinitionVersion`) y AR `RecurringOccurrence` (agregado separado, alto volumen); VOs `AmountSpec` (`FIXED`/`ESTIMATED`/`MIN_MAX`/`VARIABLE`), `ScheduleSpec`, `MaterializationSpec`; DS puros `OccurrenceGenerator` (candidatos por versión y ventana), `OccurrenceClock` (próxima/atrasada), `RevisionPlanner` (pausa, reanudación, fin, revisión), `CommittedCalculator`; máquinas `RECURRING_DEFINITION_LIFECYCLE` y `RECURRING_OCCURRENCE_LIFECYCLE`. La expansión de fechas (`RecurrenceRule`, `RRuleSubset`, `WeekendAdjustment`) vive en `@pf/shared-kernel/recurrence` (la reutilizarán Debt y Subscriptions). |
| `application` | `DefinitionsService` (crear, anotar, revisar, pausar, reanudar, terminar), `OccurrencesService` (aprobar, editar, omitir, vincular, liberar al anular, creación automática), `GenerateOccurrencesService` (job por workspace), `CommitmentsQueries` (definiciones, ocurrencias, comprometido, próximos pagos y los contratos públicos). Dobles en `application/testing`. |
| `infrastructure` | Repositorios SQL: `INSERT … ON CONFLICT (definition_id, occurrence_date) DO NOTHING RETURNING`, `FOR UPDATE`, control optimista por versión; versiones append-only. |
| `interface` | `CommitmentsModule` + `RecurringController` (`/recurring*`), consumidor `commitments.transaction-voided` y job `commitments.generate-occurrences`. |
| `contracts` | Eventos `commitments.*.v1`, `CommittedQuery`, `UpcomingPaymentsQuery`, `ResolvedOccurrencesQuery`, `DefinitionStatsQuery`, `RecurringDefinitionPort` (reservado), `OccurrenceLinkPort`, `COMMITMENTS_AUDIT_POLICY` y las secciones de portabilidad (orden 750). |

Dependencias: solo `contracts` de Transactions (`RecurringTransactionPort`, `TransactionLinkQuery`, `PendingFlowQuery`),
Accounts, Classification, FX, Identity y Audit, y `@pf/shared-kernel`/`@pf/platform`. **No** importa `@pf/planning`: el
puerto `FinancialPeriodPort` se adapta en la composición de `apps/api` (`financialPeriodPort`).

Esquema de BD: `apps/api/db/migrations/20261010100000_commitments_recurrence.sql` (schema `commitments`, RLS forzada) y
`20261010100100_txn_recurring_occurrence_ref_ix.sql` (índice único parcial de `txn.transaction`). Decisiones en
`openspec/changes/add-recurrence-engine/design.md`.

| Script | Efecto |
|---|---|
| `pnpm test` | Unitarios, propiedades y aplicación con dobles en memoria (`src/**/*.test.ts`; `NIGHTLY=1` ⇒ 10 000 corridas de las propiedades del shared-kernel) |
| `pnpm test:integration` | Repositorios, barreras de BD, RLS y concurrencia contra PostgreSQL 18 (Testcontainers; requiere Docker). Las pruebas de API y del worker viven en `apps/api/test/api/recurring.api.test.ts` |
